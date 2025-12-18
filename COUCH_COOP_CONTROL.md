# Couch Co-op Control

This feature allows viewers to spawn and control couch co-op players in supported Unity games via AWS AppSync messaging. Viewers can spawn their own player character and control it using keyboard commands sent through the AppSync event channel.

## Overview

The Couch Co-op Control system enables real-time viewer participation in gameplay streams. When enabled and the game supports it, viewers can:

-   Spawn a couch co-op player character in the game
-   Control the player using arrow keys (movement) and spacebar (jump)
-   See visual feedback for control status
-   Automatically despawn after a configurable period of inactivity

## Configuration

### Frontend Configuration

Enable the feature by setting the feature flag in `amazon-gamelift-streams-react-starter-frontend/src/utils/constants.ts`:

```typescript
export const ENABLE_REMOTE_PLAYER_CONTROL = true;
```

Additionally, each game in the game library must have `supportsCouchCoop` set to `true`:

```typescript
export const GAMELIFT_STREAMS_CONFIG = {
    gameLibrary: {
        'My Game': {
            applicationId: 'a-example123',
            streamGroupId: 'sg-example456',
            supportsDirectBroadcast: true,
            supportsCouchCoop: true, // Enable couch co-op for this game
        },
    },
};
```

### Configurable Parameters

The following parameters can be adjusted in `ViewerView.tsx`:

```typescript
// Message rate limiting (stay under AppSync's 25 RPS limit)
const messageRateLimit = 1000 / 20; // 20 messages per second

// Spacebar debouncing (prevent jump spam)
const spacebarDebounceTime = 100; // 100ms

// Auto-despawn timeout
const inactivityTimeout = 5000; // 5 seconds (configurable)
```

## Unity Game Integration

The Unity game must implement the following components to support couch co-op control:

### Required Components

1. **ViewerInteractionManager.cs** - Handles AppSync events and manages couch co-op players
2. **CouchCoopPlayerController.cs** - Controls couch co-op player movement
3. **Couch Co-op Player Prefab** - GameObject template for spawned players

### AppSync Event Format

The system sends the following event types:

#### SPAWN_PLAYER

```json
{
    "action": "SPAWN_PLAYER",
    "user": "viewer_username",
    "message": "",
    "timestamp": "2025-12-17T10:30:00Z"
}
```

#### MOVE_PLAYER

```json
{
    "action": "MOVE_PLAYER",
    "user": "viewer_username",
    "message": "{\"keys\":[\"ArrowUp\",\"ArrowRight\",\" \"]}",
    "timestamp": "2025-12-17T10:30:05Z"
}
```

#### DESPAWN_PLAYER

```json
{
    "action": "DESPAWN_PLAYER",
    "user": "viewer_username",
    "message": "",
    "timestamp": "2025-12-17T10:30:30Z"
}
```

### Supported Keys

-   `ArrowUp` - Move forward
-   `ArrowDown` - Move backward
-   `ArrowLeft` - Move left
-   `ArrowRight` - Move right
-   `" "` (space) - Jump

Multiple keys can be pressed simultaneously for diagonal movement and jumping while moving.

## User Experience

### For Viewers

1. **Joining**: Click the controller icon in the top-left corner of the gameplay video (only visible for supported games)
2. **Controlling**: Use arrow keys and spacebar to control the couch co-op player
3. **Visual Feedback**:
    - "Controls Active" indicator when the video area has focus
    - "Click to control" when spawned but not focused
4. **Auto-despawn**: Player automatically despawns after 5 seconds of inactivity

### UI Elements

-   **Join Button**: Small, semi-transparent controller icon in top-left corner (only shown for supported games)
-   **Status Indicator**: Shows control state in top-right area
-   **Focus Outline**: Blue outline appears when gameplay area has keyboard focus

## Technical Implementation

### Message Flow

1. **Viewer Input**: Keyboard events captured via `requestAnimationFrame` loop
2. **Throttling**: Messages limited to 20/second to stay under AppSync's 25 RPS limit
3. **Batching**: Keys sent as arrays to support simultaneous inputs
4. **Debouncing**: Spacebar limited to prevent jump spam

### Performance Considerations

-   **Rate Limiting**: 20 messages/second maximum (leaves buffer under AppSync's 25/second limit)
-   **Efficient Updates**: Only sends messages when keys are pressed
-   **Memory Management**: Proper cleanup of timers and event listeners

### Error Handling

-   Graceful degradation if AppSync connection fails
-   Console logging for debugging
-   User-friendly error messages for connection issues

## Limitations

### Current Implementation

-   **AppSync RPS Limit**: Limited to 25 requests per second per client connection
-   **Single Channel**: All viewers share the same AppSync channel
-   **No Persistence**: Player state is not saved between sessions
-   **Basic Controls**: Limited to arrow keys and spacebar

### Potential Improvements

The 25 RPS limitation could be improved by using alternative pub/sub solutions:

-   **Amazon Kinesis Data Streams**: Higher throughput for real-time messaging
-   **WebSocket Connections**: Direct real-time communication
-   **Any Third-Party Provider**: Bring your own!

## Security Considerations

-   **Input Validation**: All keyboard inputs are validated before processing
-   **Rate Limiting**: Built-in protection against message flooding
-   **User Identification**: Each player is uniquely identified by viewer username
-   **Timeout Protection**: Automatic cleanup prevents abandoned players

## Troubleshooting

### Common Issues

1. **Join Button Not Visible**: Game may not support couch co-op - check game configuration
2. **Player Not Spawning**: Check console for AppSync connection errors
3. **Controls Not Working**: Ensure gameplay area has focus (click on it)
4. **Laggy Movement**: Check network connection and AppSync message delivery
5. **Player Disappears**: Normal behavior after 5 seconds of inactivity

### Debug Information

Enable detailed logging by checking browser console for:

-   `Sent SPAWN_PLAYER event`
-   `Sent MOVE_PLAYER event`
-   `Sent DESPAWN_PLAYER event`
-   AppSync connection status messages

## Future Enhancements

Potential features for future development:

-   **Configurable Controls**: Custom key bindings
-   **Player Customization**: Avatar colors, names, accessories
-   **Spectator Mode**: Watch-only mode before spawning
-   **Player Limits**: Maximum concurrent remote players
-   **Advanced Movement**: Continuous movement, mouse look
-   **Game-Specific Actions**: Context-sensitive controls per game
-   **Persistence**: Save player progress and state
-   **Social Features**: Player chat, emotes, reactions

## Development Setup

To test the remote player control feature:

1. Enable the feature flag in `constants.ts`
2. Ensure Unity game has remote player components implemented
3. Configure AppSync credentials for your environment
4. Test with multiple browser tabs to simulate multiple viewers
5. Monitor AppSync metrics for message delivery and rate limiting

## API Reference

### Frontend Methods

```typescript
// Spawn a couch co-op player
spawnCouchCoopPlayer(): Promise<void>

// Despawn the current player
despawnCouchCoopPlayer(): Promise<void>

// Send movement command
sendMovementCommand(keys: string[]): Promise<void>

// Reset inactivity timer
resetInactivityTimer(): void
```

### Configuration Constants

```typescript
ENABLE_REMOTE_PLAYER_CONTROL: boolean;
messageRateLimit: number;
inactivityTimeout: number;
```
