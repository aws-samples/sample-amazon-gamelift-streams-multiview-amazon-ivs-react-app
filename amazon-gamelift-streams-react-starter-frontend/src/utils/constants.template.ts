/**
 * Application Constants Template
 * Contains non-sensitive configuration for IVS, Cognito, GameLift Streams, and UI styling.
 * Sensitive values (AppSync credentials, stream keys) are stored in AWS Systems Manager
 * Parameter Store and fetched at runtime via the /config API endpoint.
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
// Sensitive AppSync values (apiKey, endpoints, channelName) are stored in
// AWS Systems Manager Parameter Store and fetched at runtime via the /config API endpoint.
// See utils/configService.ts for the runtime config service.
// No manual configuration of AppSync values is required.

// GameLift Streams Configuration
// Configure multiple games with descriptive names for easy selection
// Note: Interactive Play Testing view only supports games with supportsDirectBroadcast: true
export const GAMELIFT_STREAMS_CONFIG = {
  gameLibrary: {
    "My Game Demo": {
      applicationId: 'a-XXXXXXXXXXXXX', // Your GameLift Streams Application ID
      streamGroupId: 'sg-XXXXXXXXXXXXX', // Your GameLift Streams Stream Group ID
      supportsDirectBroadcast: true, // Whether this game supports GameLift-IVS Direct Broadcast
      supportsCouchCoop: true, // Whether this game supports couch co-op control for viewers
      availableGameplayRegions: ['us-west-2'], // Regions configured in the stream group for gameplay
    },
    "Another Game": {
      applicationId: 'a-YYYYYYYYYYYYY', // Another GameLift Streams Application ID
      streamGroupId: 'sg-YYYYYYYYYYYYY', // Another GameLift Streams Stream Group ID
      supportsDirectBroadcast: false, // This game doesn't support direct broadcast (Player View only)
      supportsCouchCoop: false, // This game doesn't support couch co-op
      availableGameplayRegions: ['us-west-2', 'eu-west-2'], // Regions configured in the stream group for gameplay
    }
  },
  gameLiftStreamsControlPlaneRegion: 'us-west-2', // The region where your GameLift Streams control plane resources are deployed
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

// Set to true to enable couch co-op control for supported games
// This feature allows viewers to spawn and control players in games that support it
export const ENABLE_REMOTE_PLAYER_CONTROL = false;

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
