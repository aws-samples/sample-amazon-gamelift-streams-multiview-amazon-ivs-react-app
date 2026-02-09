/**
 * AppSync Message Transport
 * Wraps the existing AppSyncChatClient to conform to the MessageTransport interface.
 * This is the default transport — no behavior change from the original implementation.
 */

import { AppSyncChatClient } from '../AppSyncChatClient';
import { MessageTransport } from './MessageTransport';

export class AppSyncTransport implements MessageTransport {
  private chatClient: AppSyncChatClient;

  constructor(chatClient: AppSyncChatClient) {
    this.chatClient = chatClient;
  }

  async connect(): Promise<void> {
    // AppSyncChatClient manages its own connection lifecycle.
    // By the time ViewerView uses this, the client is already connected.
  }

  async publishRaw(event: any): Promise<void> {
    await this.chatClient.publishRaw(event);
  }

  disconnect(): void {
    // Lifecycle managed by the chat client — don't disconnect here
    // since chat still needs the connection.
  }

  isReady(): boolean {
    return this.chatClient.isConnectionOpen();
  }
}
