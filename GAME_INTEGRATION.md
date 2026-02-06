# Integrating AWS AppSync from Your Game

This guide demonstrates how to integrate AWS AppSync Event API directly from your game client to enable real-time viewer interactions that affect gameplay. This allows viewers watching your stream to influence the game through chat messages and reactions.

## Overview

The AWS AppSync Event API used for viewer chat and reactions in the web frontend can also be accessed directly from your game client. This enables bidirectional communication where:

- Viewers send chat messages and reactions through the web interface
- Your game receives these events in real-time via WebSocket
- Game logic responds to viewer input (spawning items, triggering effects, etc.)
- Game can publish events back to viewers

## Architecture

```
Viewer Browser → AppSync Event API ← Game Client
                       ↓
                  WebSocket
                       ↓
              Game Logic Updates
```

## Connection Flow

1. **Obtain AppSync Configuration**: Pass AppSync credentials to your game client (API key, endpoints, channel name)
2. **Establish WebSocket Connection**: Connect to AppSync realtime endpoint with proper authentication
3. **Subscribe to Channel**: Subscribe to the same channel used by the web frontend
4. **Handle Events**: Process incoming viewer events and update game state
5. **Publish Events** (optional): Send game events back to viewers

## Configuration

Your game needs these AppSync configuration values (same as the web frontend):

```javascript
{
  apiKey: "your-appsync-api-key",
  httpEndpoint: "your-http-endpoint.appsync-api.region.amazonaws.com",
  realtimeEndpoint: "your-realtime-endpoint.appsync-realtime-api.region.amazonaws.com",
  channelName: "your-channel-namespace/channel-name"
}
```

These values are stored in AWS Systems Manager Parameter Store and served to the frontend at runtime via the authenticated `/config` API endpoint. The frontend passes them to the game client via the GameLift Data Channel when establishing the stream session.

### Passing Configuration to Game

You can pass these values to your game client through:

- **GameLift Data Channel**: The frontend automatically sends AppSync configuration to the game when the data channel is established (recommended) - see [DATA_CHANNEL_INTEGRATION.md](DATA_CHANNEL_INTEGRATION.md) for implementation details
- **Environment Variables**: Configure during game deployment
- **Configuration File**: Include in game build or download at runtime

## Implementation Example (Unity/C#)

**Prerequisites**: This example requires the [NativeWebSocket](https://github.com/endel/NativeWebSocket) plugin for Unity. Install it via the Unity Package Manager or download from the repository.

Here's a simplified example showing the core concepts:

```csharp
using UnityEngine;
using System;
using System.Text;
using System.Collections.Generic;
using NativeWebSocket;

// Event message structures
[Serializable]
public class ViewerEvent
{
    public string action;
    public string message;
    public string user;
    public string reaction;
}

[Serializable]
public class WebSocketMessage
{
    public string id;
    public string type;
    public string @event;
}

public class ViewerInteractionManager : MonoBehaviour
{
    // AppSync configuration
    private string appSyncApiKey;
    private string appSyncHttpEndpoint;
    private string appSyncRealtimeEndpoint;
    private string channelName;

    private WebSocket websocket;
    private string authProtocol;

    // Game interaction counters
    private int likeCounter = 0;
    private const int LIKES_PER_REWARD = 5;

    // Configure and connect to AppSync
    public async void ConfigureAndConnect(string apiKey, string httpEndpoint,
                                         string realtimeEndpoint, string channel)
    {
        // Store configuration
        appSyncApiKey = apiKey;
        appSyncHttpEndpoint = httpEndpoint.Replace("https://", "").Replace("http://", "");
        appSyncRealtimeEndpoint = realtimeEndpoint;
        channelName = channel;

        // Create authorization header
        var authorization = new Dictionary<string, string>
        {
            { "x-api-key", appSyncApiKey },
            { "host", appSyncHttpEndpoint }
        };
        authProtocol = GetAuthProtocol(authorization);

        // Build WebSocket URL
        string wsUrl = $"wss://{appSyncRealtimeEndpoint}/event/realtime";

        // Create WebSocket with required protocols
        List<string> protocols = new List<string>
        {
            "aws-appsync-event-ws",
            authProtocol
        };
        websocket = new WebSocket(wsUrl, protocols);

        // Set up event handlers
        websocket.OnOpen += () =>
        {
            Debug.Log("Connected to AppSync!");
            SubscribeToChannel(channelName);
        };

        websocket.OnMessage += (bytes) =>
        {
            var message = Encoding.UTF8.GetString(bytes);
            HandleWebSocketMessage(message);
        };

        websocket.OnError += (error) =>
        {
            Debug.LogError($"WebSocket error: {error}");
        };

        websocket.OnClose += (code) =>
        {
            Debug.Log("WebSocket closed");
        };

        // Connect
        await websocket.Connect();
    }

    // Create base64-encoded authorization protocol header
    private string GetAuthProtocol(Dictionary<string, string> authorization)
    {
        string jsonAuth = $"{{\"x-api-key\":\"{authorization["x-api-key"]}\",\"host\":\"{authorization["host"]}\"}}";
        byte[] bytes = Encoding.UTF8.GetBytes(jsonAuth);
        string base64 = Convert.ToBase64String(bytes);

        // Make URL-safe
        string header = base64.Replace('+', '-')
                             .Replace('/', '_')
                             .TrimEnd('=');

        return $"header-{header}";
    }

    // Subscribe to AppSync channel
    public async void SubscribeToChannel(string channel)
    {
        string subscribeMessage = $@"{{
            ""id"":""{Guid.NewGuid()}"",
            ""type"":""subscribe"",
            ""channel"":""{channel}"",
            ""authorization"":{{
                ""x-api-key"":""{appSyncApiKey}""
            }}
        }}";

        await websocket.SendText(subscribeMessage);
        Debug.Log($"Subscribed to channel: {channel}");
    }

    // Handle incoming WebSocket messages
    private void HandleWebSocketMessage(string message)
    {
        try
        {
            var wsMessage = JsonUtility.FromJson<WebSocketMessage>(message);

            if (wsMessage.type == "data" && !string.IsNullOrEmpty(wsMessage.@event))
            {
                var viewerEvent = JsonUtility.FromJson<ViewerEvent>(wsMessage.@event);
                ProcessViewerEvent(viewerEvent);
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning($"Failed to parse message: {e.Message}");
        }
    }

    // Process viewer events and update game
    private void ProcessViewerEvent(ViewerEvent viewerEvent)
    {
        switch (viewerEvent.action)
        {
            case "STREAM_REACT":
                HandleReaction(viewerEvent.reaction);
                break;

            case "USER_CHAT_MESSAGE":
                HandleChatMessage(viewerEvent.user, viewerEvent.message);
                break;

            case "STREAM_SUBSCRIBE":
                HandleNewSubscriber(viewerEvent.user);
                break;
        }
    }

    // Handle viewer reactions
    private void HandleReaction(string reactionType)
    {
        switch (reactionType)
        {
            case "like":
                likeCounter++;
                Debug.Log($"Received like! Total: {likeCounter}");

                // Spawn reward every N likes
                if (likeCounter % LIKES_PER_REWARD == 0)
                {
                    SpawnHealthPickup();
                }
                break;

            case "fire":
                SpawnEnemy();
                break;

            case "star":
                SpawnPowerup();
                break;
        }
    }

    // Handle chat messages
    private void HandleChatMessage(string user, string message)
    {
        Debug.Log($"{user}: {message}");

        // Example: Parse chat commands
        if (message.StartsWith("!"))
        {
            ProcessChatCommand(message.Substring(1));
        }
    }

    // Handle new subscribers
    private void HandleNewSubscriber(string user)
    {
        Debug.Log($"{user} subscribed!");
        // Trigger special effect or reward
    }

    // Example game actions
    private void SpawnHealthPickup()
    {
        Debug.Log("Spawning health pickup from viewer likes!");
        // Your spawn logic here
    }

    private void SpawnEnemy()
    {
        Debug.Log("Spawning enemy from viewer fire reaction!");
        // Your spawn logic here
    }

    private void SpawnPowerup()
    {
        Debug.Log("Spawning powerup from viewer star reaction!");
        // Your spawn logic here
    }

    private void ProcessChatCommand(string command)
    {
        Debug.Log($"Processing chat command: {command}");
        // Handle custom chat commands
    }

    // Update loop - required for WebSocket message processing
    void Update()
    {
        #if !UNITY_WEBGL || UNITY_EDITOR
        if (websocket != null)
        {
            websocket.DispatchMessageQueue();
        }
        #endif
    }

    // Clean up on destroy
    private async void OnDestroy()
    {
        if (websocket != null && websocket.State == WebSocketState.Open)
        {
            await websocket.Close();
        }
    }
}
```

## Event Types

Your game will receive these event types from viewers:

### STREAM_REACT

Viewer sent a reaction (like, fire, clap, wow, laugh, star)

```json
{
    "action": "STREAM_REACT",
    "reaction": "like",
    "user": "viewer123",
    "timestamp": "2024-01-01T12:00:00Z"
}
```

### USER_CHAT_MESSAGE

Viewer sent a chat message

```json
{
    "action": "USER_CHAT_MESSAGE",
    "user": "viewer123",
    "message": "Great gameplay!",
    "timestamp": "2024-01-01T12:00:00Z"
}
```

### STREAM_SUBSCRIBE

New viewer subscribed

```json
{
    "action": "STREAM_SUBSCRIBE",
    "user": "newviewer456",
    "timestamp": "2024-01-01T12:00:00Z"
}
```

## Implementation Patterns

### Threshold-Based Actions

Accumulate reactions and trigger actions at thresholds:

```csharp
private int likeCounter = 0;
private const int LIKES_PER_REWARD = 5;

if (likeCounter % LIKES_PER_REWARD == 0)
{
    SpawnReward();
}
```

### Chat Commands

Parse chat messages for special commands:

```csharp
if (message.StartsWith("!spawn"))
{
    string itemType = message.Substring(7);
    SpawnItem(itemType);
}
```

### Cooldown Management

Prevent spam by implementing cooldowns:

```csharp
private float lastSpawnTime = 0f;
private const float SPAWN_COOLDOWN = 5f;

if (Time.time - lastSpawnTime > SPAWN_COOLDOWN)
{
    SpawnEnemy();
    lastSpawnTime = Time.time;
}
```

## Best Practices

### Connection Management

- Implement automatic reconnection on disconnect
- Handle scene transitions gracefully
- Store configuration persistently across scenes

### Performance

- Process events on the main thread
- Batch multiple reactions into single game actions
- Use object pooling for spawned items

### Game Balance

- Set reasonable thresholds for viewer-triggered actions
- Implement cooldowns to prevent overwhelming the game
- Consider viewer count when scaling effects

### Security

- Validate all incoming data
- Sanitize chat messages before display
- Rate-limit viewer actions server-side

## Testing

### Local Testing

Use the web frontend's Demo Mode to generate test events:

1. Sign in as player
2. Enable Demo Mode
3. Observe events in your game client

### Multi-User Testing

1. Open multiple browser windows
2. Sign in as different viewers
3. Send reactions and chat messages
4. Verify game receives and processes events

## Troubleshooting

**Connection Issues**

- Verify AppSync endpoints and API key are correct
- Check WebSocket protocol headers match AppSync requirements
- Ensure authorization header is properly base64-encoded

**Events Not Received**

- Confirm subscription to correct channel name
- Check WebSocket connection state
- Verify message parsing logic

**Performance Issues**

- Implement event batching
- Add cooldowns between actions
- Use object pooling for frequently spawned items

## Additional Resources

- [AWS AppSync Event API Documentation](https://docs.aws.amazon.com/appsync/latest/eventapi/what-is-event-api.html)
- [WebSocket Protocol Specification](https://datatracker.ietf.org/doc/html/rfc6455)
- [GameLift Streams Developer Guide](https://docs.aws.amazon.com/gameliftstreams/latest/developerguide/)

## Next Steps

Once you have basic integration working:

1. **Enhance Interactions**: Add more reaction types and chat commands
2. **Visual Feedback**: Display viewer names and messages in-game
3. **Analytics**: Track viewer engagement metrics
4. **Moderation**: Implement chat filtering and moderation tools
5. **Rewards**: Create viewer progression systems and rewards
