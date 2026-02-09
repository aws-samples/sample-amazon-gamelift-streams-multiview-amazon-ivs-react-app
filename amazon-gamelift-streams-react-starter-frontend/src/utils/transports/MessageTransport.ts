/**
 * MessageTransport Interface
 * Abstraction layer for pub/sub message transport.
 * Implementations can use AppSync, PubNub, or any other pub/sub service.
 */

export interface MessageTransport {
  /** Connect to the transport and subscribe to the channel */
  connect(): Promise<void>;

  /** Publish a raw event payload (JSON-serializable object) */
  publishRaw(event: any): Promise<void>;

  /** Disconnect and clean up resources */
  disconnect(): void;

  /** Whether the transport is currently connected and ready to publish */
  isReady(): boolean;
}
