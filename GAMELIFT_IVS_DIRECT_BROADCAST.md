# GameLift-IVS Direct Broadcast Feature

## Overview

The GameLift-IVS Direct Broadcast feature integration enables Amazon GameLift instances to broadcast gameplay directly to Amazon IVS Real-Time Stages without restreaming from a browser. This approach significantly reduces latency and improves stream quality by eliminating the browser as a relay point.

**Note**: This feature requires that your GameLift Application be deployed with a specific 'sidecar' application, which is not included in this repository. For more information on this sidecar, see the following repo: [GameLift Streams to IVS Streaming Client](https://github.com/aws-samples/sample-gls-ivs-streaming-client).

### Traditional vs. Direct Broadcast

**Traditional Browser-Based Broadcast:**

```
GameLift Instance → Player's Browser (capture & re-encode) → IVS Stage → Viewers
```

**Direct Broadcast:**

```
GameLift Instance → IVS Stage → Viewers
                 ↓
              Browser (gameplay only)
```

### Key Benefits

-   **Lower Viewer Latency**: Eliminates browser capture and re-encoding overhead
-   **Better Quality**: Native streaming from GameLift instance preserves original quality
-   **Reduced Player CPU Usage**: Browser no longer needs to capture and re-encode video
-   **Simplified Architecture**: Direct connection between GameLift and IVS
-   **One-Click Setup**: Single button starts both GameLift stream and IVS broadcast

## Architecture

### High-Level Flow

1. **User Action**: Player clicks "Start Gameplay (Direct Broadcast)" button
2. **Token Generation**: Frontend generates two IVS stage tokens:
    - Pub/Sub Token for broadcasting webcam/mic and for monitoring (browser)
    - Publish token for broadcasting (GameLift instance)
3. **Environment Variables**: IVS credentials passed to GameLift instance via `AdditionalEnvironmentVariables`
4. **Session Creation**: GameLift stream session starts with IVS credentials
5. **Native Broadcast**: GameLift instance broadcasts directly to IVS using WHIP protocol
6. **Broadcast Detection**: Browser monitors IVS stage and detects when GameLift starts broadcasting
7. **Status Update**: UI updates to show "LIVE - Broadcasting Gameplay"

### Component Diagram

```text
┌─────────────────────────────────────────────────────────────────┐
│                         PlayerView                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  1. Generate IVS Tokens                                   │  │
│  │     - Pub/Sub Token (for webcam and mic and monitoring)   │  │
│  │     - Publish token (for GameLift instance)               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                            ↓                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  2. Create GameLift Session with Environment Variables    │  │
│  │     - IVS_WHIP_ENDPOINT                                   │  │
│  │     - IVS_STAGE_TOKEN                                     │  │
│  │     - Additional Stream Config Vars                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    StartStream Lambda                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  3. Validate Environment Variables                        │  │
│  │  4. Forward to GameLift StartStreamSession API            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                    GameLift Instance                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  5. Receive IVS credentials via environment variables     │  │
│  │  6. Broadcast directly to IVS using WHIP protocol         │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│                      IVS Real-Time Stage                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  7. Receive broadcast from GameLift instance              │  │
│  │  8. Distribute to viewers                                 │  │
│  │  9. Notify browser (monitoring) of new participant        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Feature Flag

The direct broadcast feature is controlled by a feature flag in `constants.ts`:

```typescript
// Feature Flags
export const ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST = false;
```

**To enable the feature:**

1. Open `amazon-gamelift-streams-react-starter-frontend/src/utils/constants.ts`
2. Set `ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST = true`
3. Rebuild the frontend: `npm run build` (in the frontend directory)
4. Redeploy (if desired): `cdk deploy AmazonGameliftStreamsReactStarterFrontendStack`

### Required Constants

The feature uses the following constants (already configured if you followed the main setup):

```typescript
// IVS WHIP Endpoint for direct broadcast
export const IVS_WHIP_ENDPOINT = 'https://global.whip.live-video.net';

// IVS Stage Configuration
export const IVS_CONFIG = {
    stageArn: 'arn:aws:ivs:REGION:ACCOUNT:stage/STAGE_ID',
};

// Stream Source Attributes
export const STREAM_SOURCE = {
    GAMEPLAY: 'gameplay',
    PLAYER_WEBCAM: 'player_webcam',
} as const;
```

## Lambda Function Updates

### StartStream Lambda Enhancement

The `StartStream` Lambda function has been enhanced to accept and forward environment variables to GameLift instances:

**New Request Parameter:**

```typescript
interface StartStreamRequest {
    AppIdentifier: string;
    SGIdentifier: string;
    SignalRequest: string;
    Regions: string[];
    AdditionalEnvironmentVariables?: {
        IVS_WHIP_ENDPOINT: string;
        IVS_STAGE_TOKEN: string;
        ENCODER_TYPE: string;
        VIDEO_WIDTH: string;
        VIDEO_HEIGHT: string;
        VIDEO_FRAMERATE: string;
        VIDEO_BITRATE: string;
        ENABLE_AUDIO: string;
        AUDIO_BITRATE: string;
    };
}
```

**Validation Logic:**

```javascript
// Validate AdditionalEnvironmentVariables if provided
if (body.AdditionalEnvironmentVariables) {
    if (typeof body.AdditionalEnvironmentVariables !== 'object') {
        throw new Error('AdditionalEnvironmentVariables must be an object');
    }

    // Validate all keys and values are strings
    for (const [key, value] of Object.entries(body.AdditionalEnvironmentVariables)) {
        if (typeof key !== 'string' || typeof value !== 'string') {
            throw new Error('All environment variable keys and values must be strings');
        }
    }
}

// Pass to GameLift API
const streamSession = await gameLiftStreams.startStreamSession({
    // ... existing parameters
    AdditionalEnvironmentVariables: body.AdditionalEnvironmentVariables,
});
```

**Location:** `lambda/StartStream/StartStream.js` (line 35)

## User Interface

### Player View Button

When the feature flag is enabled, a new button appears in the Player View settings modal:

**Button Label:** "Start Gameplay (Direct Broadcast)"

**Button Location:** Settings modal → Direct Broadcast Config tab

**Button States:**

-   **Enabled**: When no GameLift stream is running and not currently starting
-   **Disabled**: When `isDirectBroadcastStarting` is true or GameLift stream is already running
-   **Loading**: Shows spinner when `isDirectBroadcastStarting` is true

### Broadcast Status Indicator

The gameplay area displays a status indicator showing:

-   **"LIVE - Broadcasting Gameplay"**: When GameLift instance is broadcasting to IVS
-   **"Gameplay Not Broadcasting"**: When no broadcast is active

## Implementation Details

### Token Generation

The feature generates two separate IVS stage tokens:

**1. Subscribe Token (Browser Monitoring):**

```typescript
const participantToken = await gameplayStageManagerRef.current.fetchParticipantToken(
    username,
    ['SUBSCRIBE'], // Only subscribe capability
    STREAM_SOURCE.GAMEPLAY as 'gameplay'
);
```

**2. Publish Token (GameLift Instance):**

```typescript
const gameLiftPublishToken = await gameplayStageManagerRef.current.fetchParticipantToken(
    username,
    ['PUBLISH'],
    STREAM_SOURCE.PLAYER_WEBCAM as 'player_webcam'
);
```

### Environment Variables Payload

```typescript
const payload = {
    AppIdentifier: appId,
    SGIdentifier: sgId,
    SignalRequest: signalRequest,
    Regions: regions,
    AdditionalEnvironmentVariables: {
        IVS_WHIP_ENDPOINT: 'https://global.whip.live-video.net',
        IVS_STAGE_TOKEN: gameLiftPublishToken,
        ENCODER_TYPE: broadcastConfig.encoderType,
        VIDEO_WIDTH: broadcastConfig.videoWidth.toString(),
        VIDEO_HEIGHT: broadcastConfig.videoHeight.toString(),
        VIDEO_FRAMERATE: broadcastConfig.videoFramerate.toString(),
        VIDEO_BITRATE: broadcastConfig.videoBitrate.toString(),
        ENABLE_AUDIO: broadcastConfig.enableAudio.toString(),
        AUDIO_BITRATE: broadcastConfig.audioBitrate.toString(),
    },
};
```

### Broadcast Detection

The browser monitors the IVS stage for new participant streams:

```typescript
onStreamsAdded: (streams) => {
    streams.forEach((stream: any) => {
        const participantInfo = stream._participantInfo;

        // Check if this is a GameLift instance broadcasting
        if (participantInfo && participantInfo.attributes?.stream_source === 'gameplay' && !participantInfo.isLocal) {
            console.log('Detected GameLift direct broadcast from instance');
            setIsGameplayBroadcasting(true);
            setIsDirectBroadcastStarting(false);
        }
    });
};
```

## Error Handling

The feature includes comprehensive error handling with user-friendly messages:

### Token Generation Errors

**Error Message:** "Failed to generate IVS credentials. Please try again."

**Causes:**

-   IVS token API unavailable
-   Network connectivity issues
-   Invalid stage ARN

**Console Logging:**

```javascript
console.error('Token generation failed:', tokenError);
```

### Session Creation Errors

**Error Message:** "Failed to start GameLift stream with IVS broadcast. Please check your configuration."

**Causes:**

-   Lambda function rejects environment variables
-   GameLift API errors
-   Invalid configuration

**Lambda Error Display:**
The system extracts and displays error messages from Lambda responses:

```typescript
if (errorData.message) {
    errorMessage = errorData.message;
    console.error('Lambda error message:', errorData.message);
}
```

### Error Display Format

All errors use the dismissible error banner format:

-   Displayed at the top of the player view
-   Shows up to 3 most recent errors
-   Each error has a dismiss button (×)
-   "Clear all" button available when more than 3 errors exist

### Console Logging

Detailed logging throughout the flow:

```javascript
console.log('Generating IVS stage token for direct broadcast...');
console.log('Successfully generated IVS stage token for monitoring');
console.log('Creating IVS stage for monitoring GameLift broadcast...');
console.log('Successfully joined IVS stage for monitoring');
console.log('Generating IVS publish token for GameLift instance...');
console.log('Creating GameLift stream session with IVS environment variables...');
console.log('Direct broadcast session successfully started');
```

## State Management

### State Variables

```typescript
// Direct Broadcast State
const [isDirectBroadcastStarting, setIsDirectBroadcastStarting] = useState(false);
const [directBroadcastToken, setDirectBroadcastToken] = useState<string | null>(null);

// Gameplay Broadcast State (shared with manual broadcast)
const [isGameplayBroadcasting, setIsGameplayBroadcasting] = useState(false);
```

### State Transitions

**Starting Direct Broadcast:**

```
isDirectBroadcastStarting: false → true
Button: enabled → disabled (with spinner)
```

**Broadcast Detected:**

```
isDirectBroadcastStarting: true → false
isGameplayBroadcasting: false → true
Status: "Gameplay Not Broadcasting" → "LIVE - Broadcasting Gameplay"
```

**Error Occurred:**

```
isDirectBroadcastStarting: true → false
Button: disabled → enabled
Error banner: displayed
```

### Debugging

**Check Browser Console:**

```javascript
// Look for these success messages:
'Generating IVS stage token for direct broadcast...';
'Successfully generated IVS stage token for monitoring';
'Creating IVS stage for monitoring GameLift broadcast...';
'Successfully joined IVS stage for monitoring';
'Generating IVS publish token for GameLift instance...';
'Creating GameLift stream session with IVS environment variables...';
'Detected GameLift direct broadcast from instance';
'Direct broadcast session successfully started';
```

**Check CloudWatch Logs:**

-   Lambda function: `/aws/lambda/StartStream`
-   Look for environment variable validation
-   Check GameLift API responses

**Check Network Tab:**

-   POST request to `/` with `AdditionalEnvironmentVariables`
-   Verify request body includes IVS credentials
-   Check response status and body

## Troubleshooting

### Button Not Visible

**Cause:** Feature flag is disabled

**Solution:**

1. Open `constants.ts`
2. Set `ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST = true`
3. Rebuild: `npm run build`
4. Redeploy: `cdk deploy AmazonGameliftStreamsReactStarterFrontendStack`

### Token Generation Fails

**Cause:** Invalid IVS stage ARN or network issues

**Solution:**

1. Verify `IVS_CONFIG.stageArn` in `constants.ts`
2. Check browser console for detailed error
3. Verify IVS stage exists in AWS console
4. Check network connectivity

### Session Creation Fails

**Cause:** Lambda rejects environment variables or GameLift API error

**Solution:**

1. Check CloudWatch logs for Lambda function
2. Verify Lambda has been updated with environment variable support
3. Check GameLift capacity is allocated
4. Verify GameLift Application and Stream Group IDs

### Broadcast Not Detected

**Cause:** GameLift instance not broadcasting or monitoring issue

**Solution:**

1. Check browser console for "Detected GameLift direct broadcast" message
2. Verify GameLift instance received environment variables
3. Check IVS stage in AWS console for active participants
4. Verify stream_source attribute is set to "gameplay"

### Error: "Failed to generate IVS credentials"

**Cause:** IVS token API unavailable or invalid configuration

**Solution:**

1. Verify IVS stage ARN is correct
2. Check GetStageToken Lambda function logs
3. Verify API Gateway and Lambda permissions
4. Check network connectivity

### Error: "Failed to start GameLift stream with IVS broadcast"

**Cause:** Lambda or GameLift API error

**Solution:**

1. Check Lambda CloudWatch logs for detailed error
2. Verify environment variables are valid strings
3. Check GameLift capacity and configuration
4. Verify Lambda has correct IAM permissions

See [GAME_INTEGRATION.md](./GAME_INTEGRATION.md) for more details on game client integration.

## Related Documentation

-   [Main README](./README.md) - Complete application setup and deployment
-   [Game Integration Guide](./GAME_INTEGRATION.md) - Integrate viewer interactions into your game
-   [Data Channel Integration](./DATA_CHANNEL_INTEGRATION.md) - Use GameLift data channels
-   [Amazon GameLift Streams Documentation](https://docs.aws.amazon.com/gameliftstreams/)
-   [Amazon IVS Real-Time Stages Documentation](https://docs.aws.amazon.com/ivs/latest/RealTimeUserGuide/)
-   [WebRTC WHIP Protocol](https://datatracker.ietf.org/doc/html/draft-ietf-wish-whip)

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review CloudWatch logs for detailed error information
3. Check browser console for client-side errors
4. Verify all configuration values in `constants.ts`
5. Ensure all CDK stacks are properly deployed

## License

This feature is part of the Amazon GameLift Streams React Starter Sample and is licensed under the MIT-0 License. See the LICENSE file.
