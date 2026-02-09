/**
 * PubNub Message Transport
 * Implements MessageTransport using PubNub for couch co-op command delivery.
 * Credentials (publishKey, subscribeKey) are fetched from SSM via the /config endpoint.
 */

import PubNub from 'pubnub';
import { MessageTransport } from './MessageTransport';

export interface PubNubTransportConfig {
  publishKey: string;
  subscribeKey: string;
  channelName: string;
  userId: string;
}

export class PubNubTransport implements MessageTransport {
  private pubnub: PubNub | null = null;
  private config: PubNubTransportConfig;
  private connected = false;

  constructor(config: PubNubTransportConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.pubnub = new PubNub({
      publishKey: this.config.publishKey,
      subscribeKey: this.config.subscribeKey,
      userId: this.config.userId,
      ssl: true,
    });

    // Subscribe so we can confirm connectivity (and receive messages if needed later)
    this.pubnub.subscribe({ channels: [this.config.channelName] });
    this.connected = true;
    console.log('[PubNubTransport] Connected to channel:', this.config.channelName);
  }

  async publishRaw(event: any): Promise<void> {
    if (!this.pubnub || !this.connected) {
      throw new Error('[PubNubTransport] Not connected');
    }

    await this.pubnub.publish({
      channel: this.config.channelName,
      message: event,
      storeInHistory: false, // Couch co-op commands are ephemeral
    });
  }

  disconnect(): void {
    if (this.pubnub) {
      this.pubnub.unsubscribeAll();
      this.pubnub = null;
    }
    this.connected = false;
    console.log('[PubNubTransport] Disconnected');
  }

  isReady(): boolean {
    return this.connected && this.pubnub !== null;
  }
}
