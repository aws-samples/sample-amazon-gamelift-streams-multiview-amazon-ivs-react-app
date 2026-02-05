/**
 * AppSync Event API Chat Client
 * Manages WebSocket connection to AWS AppSync Event API for real-time chat
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ChatMessage,
  AppSyncConfig,
  AppSyncWebSocketMessage,
  ConnectionAckMessage,
  SubscribeSuccessMessage,
  PublishSuccessMessage,
  ControlMessage,
  ControlMessageHandler,
} from '../types/chat.types';

type MessageHandler = (message: ChatMessage) => void;
type ConnectionStateHandler = (connected: boolean) => void;

export class AppSyncChatClient {
  private ws: WebSocket | null = null;
  private config: AppSyncConfig;
  private messageHandlers: MessageHandler[] = [];
  private controlMessageHandlers: ControlMessageHandler[] = [];
  private connectionStateHandlers: ConnectionStateHandler[] = [];
  private subscriptionId: string | null = null;
  private isConnected: boolean = false;
  private isSubscribed: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private keepAliveTimeoutId: NodeJS.Timeout | null = null;
  private messageQueue: Array<{ message: string; username: string; }> = [];
  private pendingPromises: Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; }
  > = new Map();

  constructor(config: AppSyncConfig) {
    this.config = config;
  }

  /**
   * Base64URL encoding function for authorization header
   */
  private base64URLEncode(obj: Record<string, string>): string {
    const jsonString = JSON.stringify(obj);
    const base64 = btoa(jsonString);
    // Convert base64 to base64url
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /**
   * Connect to AppSync Event API WebSocket
   * Implements subtask 8.2: Catch and display WebSocket connection errors
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Build authorization header
        const authHeader = this.base64URLEncode({
          'x-api-key': this.config.apiKey,
          host: this.config.httpEndpoint.replace('https://', ''),
        });

        // Create WebSocket connection with subprotocols
        // Note: Order matters! aws-appsync-event-ws must come first
        const wsUrl = `wss://${this.config.realtimeEndpoint}/event/realtime`;
        this.ws = new WebSocket(wsUrl, [
          'aws-appsync-event-ws',
          `header-${authHeader}`,
        ]);

        // Set up event handlers
        this.ws.onopen = () => {
          console.log('WebSocket connection opened');
          this.sendConnectionInit()
            .then(() => resolve())
            .catch((error) => {
              const friendlyError = new Error('Failed to initialize chat connection. Please try again.');
              reject(friendlyError);
            });
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.notifyConnectionState(false);
          // Don't reject here - let onclose handle it
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket connection closed', event.code, event.reason);
          this.isConnected = false;
          this.isSubscribed = false;
          this.notifyConnectionState(false);
          this.clearKeepAliveTimeout();

          // Provide user-friendly error message based on close code
          if (event.code === 1006) {
            console.error('Chat connection closed abnormally');
          } else if (event.code === 1008) {
            console.error('Chat connection closed due to policy violation');
          }

          this.attemptReconnect();
        };

        // Set connection timeout
        setTimeout(() => {
          if (!this.isConnected && this.ws && this.ws.readyState !== WebSocket.OPEN) {
            const timeoutError = new Error('Chat connection timed out. Please check your internet connection.');
            reject(timeoutError);
            if (this.ws) {
              this.ws.close();
            }
          }
        }, 10000);
      } catch (error) {
        if (error instanceof Error) {
          reject(new Error(`Unable to connect to chat: ${error.message}`));
        } else {
          reject(new Error('Unable to connect to chat. Please try again.'));
        }
      }
    });
  }

  /**
   * Send connection_init message and wait for connection_ack
   */
  private async sendConnectionInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket is not open'));
        return;
      }

      const initMessage = {
        type: 'connection_init',
      };

      this.ws.send(JSON.stringify(initMessage));

      // Set up one-time handler for connection_ack
      const ackHandler = (data: string) => {
        try {
          const message: AppSyncWebSocketMessage = JSON.parse(data);
          if (message.type === 'connection_ack') {
            const ackMessage = message as ConnectionAckMessage;
            console.log('Connection acknowledged');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.notifyConnectionState(true);

            // Set up keep-alive timeout
            this.setupKeepAliveTimeout(ackMessage.connectionTimeoutMs);

            // Process queued messages
            this.processMessageQueue();

            resolve();
          }
        } catch (error) {
          // Ignore parsing errors for other messages
        }
      };

      // Temporarily add message listener
      const originalOnMessage = this.ws.onmessage;
      this.ws.onmessage = (event) => {
        ackHandler(event.data);
        // Restore original handler after ack
        if (this.ws) {
          this.ws.onmessage = originalOnMessage;
        }
      };

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.isConnected) {
          reject(new Error('Connection acknowledgment timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Set up keep-alive timeout handler
   */
  private setupKeepAliveTimeout(timeoutMs: number): void {
    this.clearKeepAliveTimeout();

    // Set timeout slightly before the server timeout
    const timeout = timeoutMs - 5000;
    this.keepAliveTimeoutId = setTimeout(() => {
      console.warn('Keep-alive timeout - connection may be stale');
      this.disconnect();
      this.attemptReconnect();
    }, timeout);
  }

  /**
   * Clear keep-alive timeout
   */
  private clearKeepAliveTimeout(): void {
    if (this.keepAliveTimeoutId) {
      clearTimeout(this.keepAliveTimeoutId);
      this.keepAliveTimeoutId = null;
    }
  }

  /**
   * Subscribe to chat channel
   */
  async subscribe(): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Not connected to WebSocket');
    }

    if (this.isSubscribed) {
      return;
    }

    return new Promise((resolve, reject) => {
      const subscriptionId = uuidv4();
      this.subscriptionId = subscriptionId;

      const subscribeMessage = {
        id: subscriptionId,
        type: 'subscribe',
        channel: this.config.channelName,
        authorization: {
          'x-api-key': this.config.apiKey,
        },
      };

      this.pendingPromises.set(subscriptionId, { resolve, reject });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(subscribeMessage));
        console.log('Sent subscribe message');

        // Timeout after 10 seconds
        setTimeout(() => {
          if (!this.isSubscribed) {
            this.pendingPromises.delete(subscriptionId);
            reject(new Error('Subscription acknowledgment timeout'));
          }
        }, 10000);
      } else {
        this.pendingPromises.delete(subscriptionId);
        reject(new Error('WebSocket is not open'));
      }
    });
  }

  /**
   * Publish a chat message via WebSocket
   */
  async publish(message: string, username: string): Promise<void> {
    if (!this.isConnected || !this.isSubscribed) {
      // Queue message for later
      this.messageQueue.push({ message, username });
      throw new Error('Not connected or subscribed - message queued');
    }

    return new Promise((resolve, reject) => {
      const publishId = uuidv4();

      const chatMessage: ChatMessage = {
        action: 'USER_CHAT_MESSAGE',
        message,
        user: username,
        timestamp: Date.now(),
      };

      // Events must be stringified JSON according to AWS docs
      const publishMessage = {
        id: publishId,
        type: 'publish',
        channel: this.config.channelName,
        events: [JSON.stringify(chatMessage)],
        authorization: {
          'x-api-key': this.config.apiKey,
        },
      };

      this.pendingPromises.set(publishId, { resolve, reject });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(publishMessage));
        console.log('Sent publish message');

        // Timeout after 10 seconds
        setTimeout(() => {
          if (this.pendingPromises.has(publishId)) {
            this.pendingPromises.delete(publishId);
            // Re-queue message for retry
            this.messageQueue.push({ message, username });
            reject(new Error('Publish acknowledgment timeout - message queued for retry'));
          }
        }, 10000);
      } else {
        this.pendingPromises.delete(publishId);
        this.messageQueue.push({ message, username });
        reject(new Error('WebSocket is not open - message queued'));
      }
    });
  }

  /**
   * Publish a raw event (like reactions) via WebSocket
   */
  async publishRaw(event: any): Promise<void> {
    if (!this.isConnected || !this.isSubscribed) {
      throw new Error('Not connected or subscribed');
    }

    return new Promise((resolve, reject) => {
      const publishId = uuidv4();

      // Events must be stringified JSON according to AWS docs
      const publishMessage = {
        id: publishId,
        type: 'publish',
        channel: this.config.channelName,
        events: [JSON.stringify(event)],
        authorization: {
          'x-api-key': this.config.apiKey,
        },
      };

      this.pendingPromises.set(publishId, { resolve, reject });

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(publishMessage));
        console.log('Sent raw event publish message');

        // Timeout after 10 seconds
        setTimeout(() => {
          if (this.pendingPromises.has(publishId)) {
            this.pendingPromises.delete(publishId);
            reject(new Error('Publish acknowledgment timeout'));
          }
        }, 10000);
      } else {
        this.pendingPromises.delete(publishId);
        reject(new Error('WebSocket is not open'));
      }
    });
  }

  /**
   * Publish a control message (non-chat) via WebSocket
   * Control messages are used for takeover coordination and other system-level communication
   */
  async publishControlMessage(action: string, payload: any): Promise<void> {
    if (!this.isConnected || !this.isSubscribed) {
      throw new Error('Not connected or subscribed');
    }

    // Validate control message structure
    if (!action || typeof action !== 'string') {
      throw new Error('Control message must have a valid action string');
    }

    if (!action.startsWith('TAKEOVER_')) {
      throw new Error('Control message action must start with TAKEOVER_');
    }

    const controlMessage = {
      action,
      ...payload,
      timestamp: Date.now(),
    };

    // Validate required fields based on action type
    if (action === 'TAKEOVER_REQUEST' && !payload.requesterUsername) {
      throw new Error('TAKEOVER_REQUEST must include requesterUsername');
    }

    if (action === 'TAKEOVER_APPROVED' && !payload.sessionId) {
      throw new Error('TAKEOVER_APPROVED must include sessionId');
    }

    return this.publishRaw(controlMessage);
  }

  /**
   * Process queued messages after reconnection
   */
  private async processMessageQueue(): Promise<void> {
    if (!this.isConnected || !this.isSubscribed || this.messageQueue.length === 0) {
      return;
    }

    const queue = [...this.messageQueue];
    this.messageQueue = [];

    for (const { message, username } of queue) {
      try {
        await this.publish(message, username);
      } catch (error) {
        console.error('Failed to send queued message:', error);
        // Message will be re-queued by publish method
      }
    }
  }

  /**
   * Handle incoming WebSocket messages
   * Implements subtask 8.2: Handle malformed messages gracefully
   */
  private handleMessage(data: string): void {
    try {
      const message: AppSyncWebSocketMessage = JSON.parse(data);

      switch (message.type) {
        case 'ka':
          // Keep-alive message - reset timeout
          console.log('Received keep-alive');
          if (this.isConnected) {
            // Reset keep-alive timeout
            this.clearKeepAliveTimeout();
            // Note: We'd need the timeout value from connection_ack
            // For now, we'll just clear it
          }
          break;

        case 'subscribe_success':
          const subSuccess = message as SubscribeSuccessMessage;
          console.log('Subscription successful');
          this.isSubscribed = true;
          const subPromise = this.pendingPromises.get(subSuccess.id);
          if (subPromise) {
            subPromise.resolve(undefined);
            this.pendingPromises.delete(subSuccess.id);
          }
          // Process any queued messages
          this.processMessageQueue();
          break;

        case 'publish_success':
          const pubSuccess = message as PublishSuccessMessage;
          console.log('Publish successful');
          const pubPromise = this.pendingPromises.get(pubSuccess.id);
          if (pubPromise) {
            pubPromise.resolve(undefined);
            this.pendingPromises.delete(pubSuccess.id);
          }
          break;

        case 'data':
          const dataMessage = message as any;
          if (dataMessage.event) {
            try {
              // Event is a stringified JSON, need to parse it
              const parsedEvent = typeof dataMessage.event === 'string'
                ? JSON.parse(dataMessage.event)
                : dataMessage.event;

              // Route messages based on action type
              if (parsedEvent.action === 'USER_CHAT_MESSAGE') {
                // Validate and route to chat handlers
                if (this.isValidChatMessage(parsedEvent)) {
                  this.notifyMessageHandlers(parsedEvent as ChatMessage);
                } else {
                  console.warn('Received malformed chat message, ignoring:', parsedEvent);
                }
              } else if (parsedEvent.action && (parsedEvent.action.startsWith('TAKEOVER_') || parsedEvent.action.startsWith('VIEWER_'))) {
                // Validate and route to control message handlers
                if (this.isValidControlMessage(parsedEvent)) {
                  this.notifyControlMessageHandlers(parsedEvent as ControlMessage);
                } else {
                  console.warn('Received malformed control message, ignoring:', parsedEvent);
                }
              } else {
                console.warn('Received message with unknown action type, ignoring:', parsedEvent.action);
              }
            } catch (error) {
              console.error('Failed to parse event, ignoring malformed message:', error);
              // Continue processing other messages - don't crash
            }
          }
          break;

        case 'error':
          // Handle error messages from AppSync
          const errorMsg = message as any;
          console.error('AppSync error message:', errorMsg);
          if (errorMsg.id) {
            // Reject any pending promise for this ID
            const promise = this.pendingPromises.get(errorMsg.id);
            if (promise) {
              const errorMessage = errorMsg.errors?.[0]?.message || 'Chat service error';
              promise.reject(new Error(`Unable to send message: ${errorMessage}`));
              this.pendingPromises.delete(errorMsg.id);
            }
          }
          break;

        default:
          console.log('Unhandled message type:', message.type);
      }
    } catch (error) {
      console.error('Error handling message, continuing:', error);
      // Don't throw - gracefully handle malformed messages
    }
  }

  /**
   * Validates that a chat message has all required fields
   * Implements subtask 8.2: Handle malformed messages gracefully
   */
  private isValidChatMessage(message: any): boolean {
    return (
      message &&
      typeof message.action === 'string' &&
      message.action === 'USER_CHAT_MESSAGE' &&
      typeof message.message === 'string' &&
      typeof message.user === 'string' &&
      typeof message.timestamp === 'number'
    );
  }

  /**
   * Validates that a control message has all required fields
   * Different control message types have different required fields
   */
  private isValidControlMessage(message: any): boolean {
    if (!message || typeof message.action !== 'string' || typeof message.timestamp !== 'number') {
      return false;
    }

    // Validate based on specific action type
    switch (message.action) {
      case 'TAKEOVER_REQUEST':
        return typeof message.requesterUsername === 'string';

      case 'TAKEOVER_APPROVED':
        return typeof message.sessionId === 'string';

      case 'TAKEOVER_DENIED':
      case 'TAKEOVER_CANCELLED':
        // These messages only need action and timestamp
        return true;

      // Viewer invite control messages
      case 'VIEWER_INVITE':
        return typeof message.inviterUsername === 'string' && typeof message.invitedUsername === 'string';

      case 'VIEWER_INVITE_ACCEPTED':
      case 'VIEWER_INVITE_DECLINED':
        return typeof message.invitedUsername === 'string';

      case 'VIEWER_INVITE_CANCELLED':
        return typeof message.inviterUsername === 'string';

      case 'VIEWER_LEFT_STAGE':
        return typeof message.viewerUsername === 'string';

      default:
        // Unknown control message type
        return false;
    }
  }

  /**
   * Register a message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Register a control message handler
   * Control messages are distinguished from chat messages by their action type
   */
  onControlMessage(handler: ControlMessageHandler): void {
    this.controlMessageHandlers.push(handler);
  }

  /**
   * Register a connection state handler
   */
  onConnectionStateChange(handler: ConnectionStateHandler): void {
    this.connectionStateHandlers.push(handler);
  }

  /**
   * Notify all message handlers
   */
  private notifyMessageHandlers(message: ChatMessage): void {
    this.messageHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('Error in message handler:', error);
      }
    });
  }

  /**
   * Notify all control message handlers
   */
  private notifyControlMessageHandlers(message: ControlMessage): void {
    this.controlMessageHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('Error in control message handler:', error);
      }
    });
  }

  /**
   * Notify all connection state handlers
   */
  private notifyConnectionState(connected: boolean): void {
    this.connectionStateHandlers.forEach((handler) => {
      try {
        handler(connected);
      } catch (error) {
        console.error('Error in connection state handler:', error);
      }
    });
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    // Clear any existing reconnect timeout
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
    }

    // Calculate backoff delay: 1s, 2s, 4s, 8s, 16s, 32s, 64s, ...
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 64000);
    this.reconnectAttempts++;

    console.log(`Attempting reconnection in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeoutId = setTimeout(async () => {
      try {
        await this.connect();
        if (this.isConnected) {
          await this.subscribe();
        }
      } catch (error) {
        console.error('Reconnection failed:', error);
      }
    }, delay);
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.isConnected = false;
    this.isSubscribed = false;
    this.subscriptionId = null;

    // Clear timeouts
    this.clearKeepAliveTimeout();
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    // Clear all handlers to prevent memory leaks and duplicate messages
    this.messageHandlers = [];
    this.controlMessageHandlers = [];
    this.connectionStateHandlers = [];

    // Reject all pending promises
    this.pendingPromises.forEach((promise) => {
      promise.reject(new Error('Connection closed'));
    });
    this.pendingPromises.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.notifyConnectionState(false);
  }

  /**
   * Get connection status
   */
  isConnectionOpen(): boolean {
    return this.isConnected && this.isSubscribed;
  }

  /**
   * Get queued message count
   */
  getQueuedMessageCount(): number {
    return this.messageQueue.length;
  }
}
