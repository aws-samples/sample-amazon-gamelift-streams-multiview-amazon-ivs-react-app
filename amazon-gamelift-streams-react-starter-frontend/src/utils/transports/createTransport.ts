/**
 * Transport Factory
 * Returns the appropriate MessageTransport based on the COUCH_COOP_TRANSPORT feature flag.
 */

import { COUCH_COOP_TRANSPORT } from '../constants';
import { getRuntimeConfig } from '../configService';
import { AppSyncChatClient } from '../AppSyncChatClient';
import { MessageTransport } from './MessageTransport';
import { AppSyncTransport } from './AppSyncTransport';
import { PubNubTransport } from './PubNubTransport';

/**
 * Creates and returns a MessageTransport for couch co-op commands.
 *
 * @param chatClient - The existing AppSyncChatClient (used when transport is 'appsync')
 * @param username - The current user's username (used as PubNub userId)
 */
export function createCouchCoopTransport(
  chatClient: AppSyncChatClient,
  username: string
): MessageTransport {
  switch (COUCH_COOP_TRANSPORT) {
    case 'pubnub': {
      const config = getRuntimeConfig();
      return new PubNubTransport({
        publishKey: config.PUBNUB_PUBLISH_KEY,
        subscribeKey: config.PUBNUB_SUBSCRIBE_KEY,
        channelName: config.PUBNUB_CHANNEL_NAME || 'couch-coop',
        userId: username,
      });
    }

    case 'appsync':
    default:
      return new AppSyncTransport(chatClient);
  }
}
