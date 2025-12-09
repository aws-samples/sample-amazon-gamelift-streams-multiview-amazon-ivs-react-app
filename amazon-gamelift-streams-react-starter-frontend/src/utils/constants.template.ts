/**
 * Application Constants Template
 * Contains configuration for AppSync, IVS, Cognito, and UI styling
 * 
 * INSTRUCTIONS:
 * 1. Copy this file to constants.ts in the same directory
 * 2. Replace all placeholder values with your actual AWS resource identifiers
 * 3. Never commit constants.ts to version control (it's in .gitignore)
 */

// Cognito Configuration
// Get these values from the AmazonGameliftStreamsReactStarterAPIStack deployment outputs
export const COGNITO_CONFIG = {
  userPoolId: 'YOUR_REGION_USERPOOLID', // From gamelift-streams-react-starter-User-Pool-Id output (e.g., 'us-west-2_IFWlX4xnn')
  userPoolClientId: 'YOUR_CLIENT_ID' // From gamelift-streams-react-starter-User-Pool-Client-Id output
};

// API Gateway Configuration
// Get this value from the AmazonGameliftStreamsReactStarterAPIStack deployment outputs
export const API_CONFIG = {
  endpoint: 'https://YOUR_API_ID.execute-api.YOUR_REGION.amazonaws.com/prod' // From Endpoint output (ensure no trailing slash)
};

// AppSync Event API Configuration
// Get these values from the AmazonGameliftStreamsReactStarterIVSStack deployment outputs
export const APPSYNC_CONFIG = {
  apiKey: 'YOUR_APPSYNC_API_KEY', // From AppSync-Event-API-Key output
  httpEndpoint: 'https://YOUR_API_ID.appsync-api.YOUR_REGION.amazonaws.com', // From AppSync-HTTP-Endpoint output
  realtimeEndpoint: 'YOUR_API_ID.appsync-realtime-api.YOUR_REGION.amazonaws.com', // From AppSync-Realtime-Endpoint output
  channelName: '/default/YOUR_API_ID' // From AppSync-Channel-Namespace output
};

// GameLift Streams Configuration
// Update these with your GameLift Streams Application and Stream Group IDs
export const GAMELIFT_STREAMS_CONFIG = {
  streamGroupId: 'sg-XXXXXXXXXXXXX', // Your GameLift Streams Stream Group ID
  applicationId: 'a-XXXXXXXXXXXXX', // Your GameLift Streams Application ID
  defaultRegion: 'us-west-2' // Your preferred AWS region
};

// IVS Stage Configuration
// Get the stage ARN from the AmazonGameliftStreamsReactStarterIVSStack deployment outputs
export const IVS_CONFIG = {
  stageArn: 'arn:aws:ivs:YOUR_REGION:YOUR_ACCOUNT_ID:stage/YOUR_STAGE_ID' // From IVS-Stage-ARN output
};

// IVS WHIP Endpoint for direct broadcast
// This value should not be changed
export const IVS_WHIP_ENDPOINT = 'https://global.whip.live-video.net';

// Feature Flags
// Set to true to enable the GameLift-IVS Direct Broadcast feature
// This feature allows GameLift instances to broadcast directly to IVS without browser intermediation
export const ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST = false;

// Color Scheme (Inspired by Game Screenshots)
// These values can remain as-is or be customized to match your branding
export const COLORS = {
  primaryBackground: '#2a1f3d',
  secondaryBackground: '#3d2f52',
  accentColor: '#ff6b9d',
  successColor: '#4ecdc4',
  textPrimary: '#ffffff',
  textSecondary: '#b8a9d1',
  borderColor: '#5a4a6f'
};

// Stream Source Attributes
// These values should not be changed
export const STREAM_SOURCE = {
  GAMEPLAY: 'gameplay',
  PLAYER_WEBCAM: 'player_webcam'
} as const;

// User Roles
// These values should not be changed
export const USER_ROLES = {
  PLAYER: 'player',
  VIEWER: 'viewer'
} as const;

// User Email Configuration
// These values should match the Cognito users you create
export const USER_EMAILS = {
  PLAYER: 'player@ivs.rocks',
  VIEWER: 'viewer@ivs.rocks'
} as const;
