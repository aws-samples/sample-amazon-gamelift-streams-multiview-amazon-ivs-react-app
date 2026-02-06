/**
 * Runtime Configuration Service
 * Fetches sensitive configuration values from the GetConfig Lambda endpoint at runtime.
 * Values are cached after the first successful fetch.
 */

import { fetchAuthSession } from 'aws-amplify/auth';
import { API_CONFIG } from './constants';

export interface RuntimeConfig {
  APPSYNC_API_KEY: string;
  APPSYNC_HTTP_ENDPOINT: string;
  APPSYNC_REALTIME_ENDPOINT: string;
  APPSYNC_CHANNEL_NAME: string;
  STREAM_KEY: string;
  // Future sensitive values will appear here automatically
  [key: string]: string;
}

let cachedConfig: RuntimeConfig | null = null;

/**
 * Fetches sensitive configuration from the backend.
 * Requires the user to be authenticated (uses Cognito ID token).
 * Results are cached for the lifetime of the page.
 */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken?.toString();

  if (!idToken) {
    throw new Error('User is not authenticated. Cannot fetch runtime configuration.');
  }

  const response = await fetch(`${API_CONFIG.endpoint}/config`, {
    method: 'GET',
    headers: {
      'Authorization': idToken,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch runtime config: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  if (!text) {
    throw new Error(`Runtime config response was empty (status ${response.status})`);
  }

  const config: RuntimeConfig = JSON.parse(text);
  cachedConfig = config;
  return config;
}

/**
 * Returns the cached config. Throws if config hasn't been fetched yet.
 * Use this in components that render after App has loaded config.
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (!cachedConfig) {
    throw new Error('Runtime config not loaded yet. Ensure fetchRuntimeConfig() is called during app initialization.');
  }
  return cachedConfig;
}

/**
 * Builds an AppSyncConfig object from the runtime config,
 * matching the shape expected by AppSyncChatClient.
 */
export function getAppSyncConfig() {
  const config = getRuntimeConfig();
  return {
    apiKey: config.APPSYNC_API_KEY,
    httpEndpoint: config.APPSYNC_HTTP_ENDPOINT,
    realtimeEndpoint: config.APPSYNC_REALTIME_ENDPOINT,
    channelName: config.APPSYNC_CHANNEL_NAME,
  };
}
