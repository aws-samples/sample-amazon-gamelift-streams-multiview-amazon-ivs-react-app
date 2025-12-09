# GameLift Data Channel Integration

This guide demonstrates how to establish a data channel connection from your Unity game to communicate with the GameLift Streams service. The data channel enables bidirectional communication between your game and external services, such as passing AWS AppSync configuration to enable viewer interactions.

## Overview

The GameLift Data Channel is a TCP-based communication channel that allows your game to:

-   Receive configuration data when the game starts
-   Send messages to connected clients (viewers, services)
-   Receive messages from external systems
-   Exchange real-time data during gameplay

## Connection Details

-   **Protocol**: TCP
-   **Host**: `127.0.0.1` (localhost)
-   **Port**: `40712`
-   **Message Format**: Binary protocol with 4-byte header + variable-length payload

## Message Protocol

Each message consists of:

```
[Client ID (1 byte)][Event Type (1 byte)][Length High (1 byte)][Length Low (1 byte)][Event Data (variable)]
```

### Event Types

-   `0`: Client connected
-   `1`: Client disconnected
-   `2`: Message data

### Message Length

The length is encoded as a 16-bit big-endian integer split across two bytes:

-   Length High: Most significant byte
-   Length Low: Least significant byte

## Implementation Example (Unity/C#)

Here's a simplified implementation showing the core concepts:

```csharp
using UnityEngine;
using System;
using System.Net.Sockets;
using System.Threading;
using System.Collections.Generic;

// Configuration message structure
[Serializable]
public class AppSyncConfig
{
    public string appSyncApiKey;
    public string appSyncHttpApiEndpoint;
    public string appSyncRealtimeEndpoint;
    public string channelName;
}

[Serializable]
public class ConfigMessage
{
    public string type;
    public AppSyncConfig message;
}

public class GameLiftDataChannelManager : MonoBehaviour
{
    public static GameLiftDataChannelManager instance { get; private set; }

    private TcpClient tcpClient;
    private NetworkStream stream;
    private Thread receiveThread;
    private bool isConnected = false;
    private bool isRunning = false;

    private const string LOCALHOST = "127.0.0.1";
    private const int DATA_CHANNEL_PORT = 40712;

    private byte currentClientId = 0;
    private Queue<string> outgoingMessages = new Queue<string>();

    private void Awake()
    {
        if (instance != null && instance != this)
        {
            Destroy(this.gameObject);
            return;
        }
        instance = this;
        DontDestroyOnLoad(this.gameObject);
    }

    void Start()
    {
        ConnectToDataChannel();
    }

    // Establish TCP connection to GameLift Data Channel
    private void ConnectToDataChannel()
    {
        try
        {
            Debug.Log($"Connecting to GameLift Data Channel at {LOCALHOST}:{DATA_CHANNEL_PORT}");

            tcpClient = new TcpClient();
            tcpClient.Connect(LOCALHOST, DATA_CHANNEL_PORT);
            stream = tcpClient.GetStream();

            isConnected = true;
            isRunning = true;

            Debug.Log("Data Channel connected!");

            // Start background thread to receive messages
            receiveThread = new Thread(ReceiveData);
            receiveThread.IsBackground = true;
            receiveThread.Start();
        }
        catch (Exception e)
        {
            Debug.LogWarning($"Failed to connect to Data Channel: {e.Message}");
            Debug.LogWarning("This is normal if not running in GameLift Streams environment");
            isConnected = false;
        }
    }

    // Background thread to receive messages
    private void ReceiveData()
    {
        try
        {
            while (isRunning && stream != null)
            {
                // Read 4-byte header
                byte[] header = new byte[4];
                int headerBytesRead = 0;

                while (headerBytesRead < 4)
                {
                    int read = stream.Read(header, headerBytesRead, 4 - headerBytesRead);
                    if (read == 0)
                    {
                        Debug.LogWarning("Connection closed by remote host");
                        return;
                    }
                    headerBytesRead += read;
                }

                // Parse header
                byte clientId = header[0];
                byte eventType = header[1];
                byte lengthHigh = header[2];
                byte lengthLow = header[3];

                // Calculate payload length (big-endian)
                int eventLength = (lengthHigh << 8) | lengthLow;

                // Read payload
                byte[] eventData = new byte[eventLength];
                if (eventLength > 0)
                {
                    int bytesRead = 0;
                    while (bytesRead < eventLength)
                    {
                        int read = stream.Read(eventData, bytesRead, eventLength - bytesRead);
                        if (read == 0)
                        {
                            Debug.LogWarning("Connection closed while reading payload");
                            return;
                        }
                        bytesRead += read;
                    }
                }

                // Process event on main thread
                UnityMainThreadDispatcher.Instance().Enqueue(() =>
                    ProcessEvent(clientId, eventType, eventData));
            }
        }
        catch (Exception e)
        {
            Debug.LogError($"Data Channel receive error: {e.Message}");
        }
    }

    // Process received events
    private void ProcessEvent(byte clientId, byte eventType, byte[] eventData)
    {
        switch (eventType)
        {
            case 0: // Client connected
                currentClientId = clientId;
                Debug.Log($"Client {clientId} connected");

                // Send acknowledgment
                SendMessage("Connection established");
                break;

            case 1: // Client disconnected
                Debug.Log($"Client {clientId} disconnected");
                break;

            case 2: // Message received
                string message = System.Text.Encoding.UTF8.GetString(eventData);
                Debug.Log($"Received message: {message}");
                HandleMessage(clientId, message);
                break;
        }
    }

    // Handle incoming messages
    private void HandleMessage(byte clientId, string message)
    {
        // Try to parse as AppSync configuration
        try
        {
            ConfigMessage configMsg = JsonUtility.FromJson<ConfigMessage>(message);

            if (configMsg != null && configMsg.type == "AWS_APPSYNC_CONFIG")
            {
                Debug.Log("Received AWS AppSync configuration");

                // Pass configuration to ViewerInteractionManager
                if (ViewerInteractionManager.instance != null)
                {
                    ViewerInteractionManager.instance.ConfigureAndConnect(
                        configMsg.message.appSyncApiKey,
                        configMsg.message.appSyncHttpApiEndpoint,
                        configMsg.message.appSyncRealtimeEndpoint,
                        configMsg.message.channelName
                    );
                }
                return;
            }
        }
        catch (Exception e)
        {
            Debug.Log($"Message is not JSON config: {e.Message}");
        }

        // Handle as regular message
        Debug.Log($"Received text message: {message}");
    }

    // Send message to client
    public void SendMessage(string message)
    {
        if (!isConnected)
        {
            Debug.LogWarning("Cannot send - not connected");
            return;
        }

        lock (outgoingMessages)
        {
            outgoingMessages.Enqueue(message);
        }
    }

    // Update loop - send queued messages
    void Update()
    {
        if (isConnected && stream != null)
        {
            lock (outgoingMessages)
            {
                while (outgoingMessages.Count > 0)
                {
                    string message = outgoingMessages.Dequeue();
                    SendMessageInternal(message);
                }
            }
        }
    }

    // Internal method to send message
    private void SendMessageInternal(string message)
    {
        try
        {
            byte[] messageBytes = System.Text.Encoding.UTF8.GetBytes(message);
            int messageLength = messageBytes.Length;

            // Write header
            stream.WriteByte(currentClientId);
            stream.WriteByte(2); // Event type: message
            stream.WriteByte((byte)(messageLength >> 8)); // Length high byte
            stream.WriteByte((byte)(messageLength & 0xFF)); // Length low byte

            // Write payload
            stream.Write(messageBytes, 0, messageLength);
            stream.Flush();

            Debug.Log($"Sent {messageLength} bytes");
        }
        catch (Exception e)
        {
            Debug.LogError($"Failed to send message: {e.Message}");
            isConnected = false;
        }
    }

    // Cleanup
    private void OnDestroy()
    {
        isRunning = false;

        if (receiveThread != null && receiveThread.IsAlive)
        {
            receiveThread.Join(1000);
        }

        if (stream != null)
        {
            stream.Close();
        }

        if (tcpClient != null)
        {
            tcpClient.Close();
        }
    }
}

// Helper class to execute actions on main Unity thread
public class UnityMainThreadDispatcher : MonoBehaviour
{
    private static UnityMainThreadDispatcher _instance;
    private Queue<Action> _executionQueue = new Queue<Action>();

    public static UnityMainThreadDispatcher Instance()
    {
        if (_instance == null)
        {
            GameObject go = new GameObject("UnityMainThreadDispatcher");
            _instance = go.AddComponent<UnityMainThreadDispatcher>();
            DontDestroyOnLoad(go);
        }
        return _instance;
    }

    public void Enqueue(Action action)
    {
        lock (_executionQueue)
        {
            _executionQueue.Enqueue(action);
        }
    }

    void Update()
    {
        lock (_executionQueue)
        {
            while (_executionQueue.Count > 0)
            {
                _executionQueue.Dequeue().Invoke();
            }
        }
    }
}
```

## Configuration Flow

1. **Game Starts**: Unity game connects to Data Channel on startup
2. **Client Connected Event**: Game receives client ID from GameLift
3. **Configuration Received**: External service sends AppSync configuration via Data Channel
4. **Parse Configuration**: Game parses JSON configuration message
5. **Initialize AppSync**: Game connects to AppSync using received credentials
6. **Ready**: Game is now ready to receive viewer interactions

## Configuration Message Format

The AppSync configuration is sent as a JSON message:

```json
{
    "type": "AWS_APPSYNC_CONFIG",
    "message": {
        "appSyncApiKey": "da2-xxxxxxxxxxxxxxxxxxxxx",
        "appSyncHttpApiEndpoint": "xxxxx.appsync-api.us-west-2.amazonaws.com",
        "appSyncRealtimeEndpoint": "xxxxx.appsync-realtime-api.us-west-2.amazonaws.com",
        "channelName": "default/game-channel"
    }
}
```

## Threading Considerations

### Background Thread

The receive loop runs on a background thread to avoid blocking the main Unity thread:

-   Continuously reads from TCP stream
-   Parses message headers and payloads
-   Queues events for main thread processing

### Main Thread

All Unity API calls must happen on the main thread:

-   Use `UnityMainThreadDispatcher` to queue actions
-   Process events in Unity's Update loop
-   Send messages from Update loop

## Error Handling

### Connection Failures

If the Data Channel connection fails, the game should:

-   Log a warning (not an error)
-   Continue running normally
-   This is expected when testing locally outside GameLift

### Disconnections

Handle unexpected disconnections gracefully:

-   Stop the receive thread
-   Clean up TCP resources
-   Optionally attempt reconnection

### Message Parsing

Validate all incoming messages:

-   Check JSON structure before parsing
-   Handle malformed messages gracefully
-   Log parsing errors for debugging

## Testing

### Local Testing

When running locally (not in GameLift Streams):

-   Connection will fail - this is expected
-   Game should continue running normally
-   Use mock configuration for testing

### GameLift Testing

When running in GameLift Streams:

-   Connection should succeed automatically
-   Monitor logs for connection status
-   Verify configuration is received correctly

## Integration with AppSync

Once the Data Channel receives AppSync configuration:

1. Pass credentials to `ViewerInteractionManager`
2. Establish WebSocket connection to AppSync
3. Subscribe to viewer event channels
4. Begin receiving viewer interactions

See [GAME_INTEGRATION.md](GAME_INTEGRATION.md) for details on AppSync integration.

## Best Practices

### Connection Management

-   Connect on game startup
-   Handle connection failures gracefully
-   Clean up resources on shutdown

### Threading

-   Keep network I/O on background thread
-   Process Unity API calls on main thread
-   Use thread-safe queues for message passing

### Message Handling

-   Validate all incoming data
-   Parse JSON safely with try-catch
-   Log all events for debugging

### Performance

-   Use efficient binary protocol
-   Minimize main thread blocking
-   Queue messages for batch processing

## Common Issues

**Connection Refused**

-   Normal when testing locally
-   Verify port 40712 is not blocked
-   Check GameLift Streams environment

**Messages Not Received**

-   Verify receive thread is running
-   Check message format matches protocol
-   Ensure proper byte order (big-endian)

**Threading Errors**

-   Always use main thread dispatcher for Unity API
-   Lock shared data structures
-   Handle thread cleanup properly

## Additional Resources

-   [GameLift Streams Developer Guide](https://docs.aws.amazon.com/gameliftstreams/latest/developerguide/)
-   [TCP Socket Programming in C#](https://docs.microsoft.com/en-us/dotnet/api/system.net.sockets.tcpclient)
-   [Unity Threading Best Practices](https://docs.unity3d.com/Manual/overview-of-dot-net-in-unity.html)

## Next Steps

After establishing the Data Channel:

1. **Receive Configuration**: Parse AppSync credentials from Data Channel
2. **Connect to AppSync**: Use credentials to establish WebSocket connection
3. **Handle Viewer Events**: Process chat and reactions from viewers
4. **Send Game Events**: Publish game state updates back to viewers
