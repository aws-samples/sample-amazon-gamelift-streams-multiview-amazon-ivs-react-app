/**
 * ViewerView Component
 * Main viewer interface with gameplay area, webcam area, and chat
 * Subscribes to IVS Real-time stage to receive player streams
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { StageConnectionState } from 'amazon-ivs-web-broadcast';
import { AppSyncChatClient } from '../utils/AppSyncChatClient';
import { IVSStageManager } from '../utils/IVSStageManager';
import { ChatComponent } from './ChatComponent';
import { VolumeControl } from './VolumeControl';
import { generateUsername } from '../utils/usernameGenerator';
import { APPSYNC_CONFIG, ENABLE_REMOTE_PLAYER_CONTROL } from '../utils/constants';
import { RemoteStageStream } from '../types/ivs.types';
import './Views.css';

interface ViewerViewProps {
  user: any;
  signOut: any;
}

export const ViewerView: React.FC<ViewerViewProps> = ({ signOut }) => {
  const navigate = useNavigate();
  
  // IVS Stage State
  const [gameplayStream, setGameplayStream] = useState<RemoteStageStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<RemoteStageStream | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // UI State
  const [username] = useState(generateUsername());
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // Couch Co-op Control State
  const [isPlayerSpawned, setIsPlayerSpawned] = useState(false);
  const isPlayerSpawnedRef = useRef(false); // Ref to track spawn state for closures
  const [isVideoFocused, setIsVideoFocused] = useState(false);
  const [gameSupportsCouch, setGameSupportsCouch] = useState(false);

  // Refs
  const gameplayVideoRef = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const stageManagerRef = useRef<IVSStageManager>(new IVSStageManager());
  const gameplayContainerRef = useRef<HTMLDivElement>(null);
  
  // Keyboard state tracking
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const animationFrameRef = useRef<number | null>(null);
  const lastSpacebarSentRef = useRef<number>(0);
  const spacebarJustPressedRef = useRef<boolean>(false);
  const lastMessageSentRef = useRef<number>(0);
  const messageRateLimit = 1000 / 20; // 20 messages per second (leaving buffer below 25/sec limit)
  
  // Inactivity tracking
  const lastActivityRef = useRef<number>(Date.now());
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityTimeout = 5000; // 5 seconds (configurable)

  // Chat Client
  const [chatClient] = useState(() => new AppSyncChatClient(APPSYNC_CONFIG));

  // Initialize on mount
  useEffect(() => {
    // Copy refs to variables at effect creation time
    const stageManager = stageManagerRef.current;
    const client = chatClient;
    
    // Don't auto-connect - wait for user interaction

    // Cleanup on unmount
    return () => {
      if (stageManager.isActive()) {
        stageManager.leaveStage();
      }
      client.disconnect();
      
      // Cancel animation frame if running
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // Clear inactivity timer
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start/stop keyboard state sending based on player spawn and focus
  useEffect(() => {
    if (isPlayerSpawned && isVideoFocused) {
      // Start the animation frame loop
      animationFrameRef.current = requestAnimationFrame(sendKeyboardState);
    } else {
      // Stop the animation frame loop
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      
      // Clear pressed keys when losing focus
      pressedKeysRef.current.clear();
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlayerSpawned, isVideoFocused]);

  /**
   * Handle subscribe button click
   */
  const handleSubscribe = async () => {
    try {
      const subscribeEvent = {
        action: 'STREAM_SUBSCRIBE',
        message: '',
        user: username,
        timestamp: Date.now()
      };

      // Publish subscribe event using publishRaw
      await (chatClient as any).publishRaw(subscribeEvent);
      
      console.log('Sent subscribe event');
      
      // Update button state
      setIsSubscribed(true);
    } catch (error) {
      console.error('Failed to send subscribe event:', error);
    }
  };

  /**
   * Spawn couch co-op player in the game
   */
  const spawnCouchCoopPlayer = async () => {
    if (isPlayerSpawned) {
      console.log('Player already spawned');
      return;
    }

    try {
      const spawnEvent = {
        action: 'SPAWN_PLAYER',
        user: username,
        message: '',
        timestamp: new Date().toISOString()
      };

      // Publish spawn event using publishRaw
      await (chatClient as any).publishRaw(spawnEvent);
      
      console.log('Sent SPAWN_PLAYER event for user:', username);
      setIsPlayerSpawned(true);
      isPlayerSpawnedRef.current = true;
      
      // Reset activity tracking
      lastActivityRef.current = Date.now();
      startInactivityTimer();
      
      // Focus the gameplay container to enable keyboard controls
      if (gameplayContainerRef.current) {
        gameplayContainerRef.current.focus();
      }
    } catch (error) {
      console.error('Failed to spawn couch co-op player:', error);
      setErrors(prev => [...prev, `Failed to spawn player: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  };

  /**
   * Despawn couch co-op player in the game
   */
  const despawnCouchCoopPlayer = async () => {
    // Use ref instead of state to avoid closure issues
    if (!isPlayerSpawnedRef.current) {
      console.log('Despawn called but player not spawned (ref check)');
      return;
    }

    console.log('Attempting to despawn player:', username);

    try {
      const despawnEvent = {
        action: 'DESPAWN_PLAYER',
        user: username,
        message: '',
        timestamp: new Date().toISOString()
      };

      console.log('Despawn event:', despawnEvent);

      // Publish despawn event using publishRaw
      const result = await (chatClient as any).publishRaw(despawnEvent);
      
      console.log('DESPAWN_PLAYER publishRaw result:', result);
      console.log('Successfully sent DESPAWN_PLAYER event for user:', username);
      
      setIsPlayerSpawned(false);
      isPlayerSpawnedRef.current = false;
      
      // Clear inactivity timer
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    } catch (error) {
      console.error('Failed to despawn couch co-op player:', error);
      console.error('Error details:', error);
    }
  };

  /**
   * Start inactivity timer
   */
  const startInactivityTimer = () => {
    // Clear existing timer
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }

    // Start new timer
    inactivityTimerRef.current = setTimeout(() => {
      console.log('Player inactive for', inactivityTimeout / 1000, 'seconds - despawning');
      despawnCouchCoopPlayer();
    }, inactivityTimeout);
  };

  /**
   * Reset inactivity timer (called on any player activity)
   */
  const resetInactivityTimer = () => {
    lastActivityRef.current = Date.now();
    if (isPlayerSpawnedRef.current) {
      startInactivityTimer();
    }
  };

  /**
   * Send movement command to AppSync with array of currently pressed keys
   */
  const sendMovementCommand = async (keys: string[]) => {
    if (!isPlayerSpawned || keys.length === 0) {
      return;
    }

    try {
      const moveEvent = {
        action: 'MOVE_PLAYER',
        user: username,
        message: JSON.stringify({ keys }),
        timestamp: new Date().toISOString()
      };

      // Publish move event using publishRaw
      await (chatClient as any).publishRaw(moveEvent);
      
      console.log('Sent MOVE_PLAYER event:', keys);
    } catch (error) {
      console.error('Failed to send movement command:', error);
    }
  };

  /**
   * Animation frame loop to send keyboard state
   */
  const sendKeyboardState = () => {
    if (!isPlayerSpawned || !isVideoFocused) {
      return;
    }

    const now = Date.now();
    const timeSinceLastMessage = now - lastMessageSentRef.current;
    
    // Throttle to stay under AppSync's 25 requests/sec limit
    if (timeSinceLastMessage < messageRateLimit) {
      // Continue the loop without sending
      animationFrameRef.current = requestAnimationFrame(sendKeyboardState);
      return;
    }

    const currentKeys = Array.from(pressedKeysRef.current).sort();
    
    // Debounce spacebar to prevent spam (only send every 100ms)
    // BUT always send on initial press (spacebarJustPressedRef)
    const hasSpacebar = currentKeys.includes(' ');
    const timeSinceLastSpace = now - lastSpacebarSentRef.current;
    
    let keysToSend = currentKeys;
    
    if (hasSpacebar) {
      // Always send if just pressed, otherwise debounce
      if (spacebarJustPressedRef.current || timeSinceLastSpace >= 100) {
        lastSpacebarSentRef.current = now;
        spacebarJustPressedRef.current = false;
      } else {
        // Remove spacebar from keys to send if it was sent recently
        keysToSend = currentKeys.filter(key => key !== ' ');
      }
    }
    
    // Send current key state (throttled to 20/sec)
    if (keysToSend.length > 0) {
      sendMovementCommand(keysToSend);
      lastMessageSentRef.current = now;
    }

    // Continue the loop
    animationFrameRef.current = requestAnimationFrame(sendKeyboardState);
  };

  /**
   * Handle keyboard input for remote player control
   */
  const handleKeyDown = (event: React.KeyboardEvent) => {
    // Only process if player is spawned and video is focused
    if (!isPlayerSpawned || !isVideoFocused) {
      return;
    }

    const key = event.key;
    
    // Check if it's a supported key
    const supportedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
    
    if (supportedKeys.includes(key)) {
      event.preventDefault(); // Prevent default browser behavior
      
      // Add key to pressed keys set
      if (!pressedKeysRef.current.has(key)) {
        pressedKeysRef.current.add(key);
        
        // Mark spacebar as just pressed to ensure it's sent immediately
        if (key === ' ') {
          spacebarJustPressedRef.current = true;
        }
        
        // Reset inactivity timer on key press
        resetInactivityTimer();
      }
    }
  };

  /**
   * Handle key release
   */
  const handleKeyUp = (event: React.KeyboardEvent) => {
    const key = event.key;
    const supportedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];
    
    if (supportedKeys.includes(key)) {
      event.preventDefault();
      pressedKeysRef.current.delete(key);
    }
  };

  /**
   * Connect to IVS stage as a subscriber
   * Implements subtask 7.2: Implement IVS stage subscription
   */
  const connectToStage = async () => {
    if (isConnecting || isConnected) {
      return;
    }

    setIsConnecting(true);
    setErrors([]);

    try {
      // Fetch participant token for viewer with SUBSCRIBE capability
      const participantToken = await stageManagerRef.current.fetchParticipantToken(
        username,
        ['SUBSCRIBE']
      );

      // Create and configure the stage
      const newStage = await stageManagerRef.current.createStage({
        participantToken,
        streams: [], // Viewers don't publish streams
        onConnectionStateChange: (state) => {
          console.log('Viewer stage connection state:', state);
          if (state === StageConnectionState.CONNECTED) {
            console.log('Successfully connected to IVS stage as viewer');
            setIsConnected(true);
            setIsConnecting(false);
          } else if (state === StageConnectionState.DISCONNECTED) {
            setIsConnected(false);
            setGameplayStream(null);
            setWebcamStream(null);
          }
        },
        onStreamsAdded: (streams) => {
          console.log('Streams added:', streams);
          handleStreamsAdded(streams);
        },
        onError: (error) => {
          console.error('Viewer stage error:', error);
          setErrors(prev => [...prev, `Stage error: ${error.message}`]);
          setIsConnecting(false);
        }
      });

      // Join the stage
      await stageManagerRef.current.joinStage();

      console.log('Successfully joined IVS stage as viewer', newStage);
    } catch (error) {
      console.error('Failed to connect to IVS stage:', error);
      setErrors(prev => [...prev, `Failed to connect: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setIsConnecting(false);
    }
  };

  /**
   * Handle streams being added
   * Implements subtask 7.3: Implement stream identification and rendering
   * Identifies streams by stream_source attribute and assigns to appropriate video elements
   * Properly handles multiple tracks (audio/video) for the same source
   */
  const handleStreamsAdded = (streams: RemoteStageStream[]) => {
    streams.forEach((stream: any) => {
      // Get participant info attached by IVSStageManager
      const participantInfo = stream._participantInfo;
      const streamSource = participantInfo?.attributes?.stream_source;
      const mediaStreamTrack = stream.mediaStreamTrack;

      if (!mediaStreamTrack) {
        console.warn('Stream has no mediaStreamTrack');
        return;
      }

      const trackKind = mediaStreamTrack.kind; // 'audio' or 'video'
      console.log(`Processing ${trackKind} track with source:`, streamSource, 'from participant:', participantInfo?.userId);

      // Assign track based on stream_source attribute
      if (streamSource === 'gameplay') {
        setGameplayStream(stream);
        
        // Check if the game supports couch co-op
        const supportsCouch = participantInfo?.attributes?.supports_couch_coop === 'true';
        setGameSupportsCouch(supportsCouch);
        console.log('Game supports couch co-op:', supportsCouch);
        
        // Get or create MediaStream for gameplay video element
        if (gameplayVideoRef.current) {
          let existingMediaStream = gameplayVideoRef.current.srcObject as MediaStream;
          
          if (!existingMediaStream) {
            // Create new MediaStream if none exists
            existingMediaStream = new MediaStream();
            gameplayVideoRef.current.srcObject = existingMediaStream;
          }
          
          // Add the track if it's not already present
          const existingTracks = existingMediaStream.getTracks();
          const trackExists = existingTracks.some(t => t.id === mediaStreamTrack.id);
          
          if (!trackExists) {
            existingMediaStream.addTrack(mediaStreamTrack);
            console.log(`✓ Added ${trackKind} track to gameplay stream`);
          }
        }
      } else if (streamSource === 'player_webcam') {
        setWebcamStream(stream);
        
        // Get or create MediaStream for webcam video element
        if (webcamVideoRef.current) {
          let existingMediaStream = webcamVideoRef.current.srcObject as MediaStream;
          
          if (!existingMediaStream) {
            // Create new MediaStream if none exists
            existingMediaStream = new MediaStream();
            webcamVideoRef.current.srcObject = existingMediaStream;
          }
          
          // Add the track if it's not already present
          const existingTracks = existingMediaStream.getTracks();
          const trackExists = existingTracks.some(t => t.id === mediaStreamTrack.id);
          
          if (!trackExists) {
            existingMediaStream.addTrack(mediaStreamTrack);
            console.log(`✓ Added ${trackKind} track to webcam stream`);
          }
        }
      } else {
        // Fallback: If no stream_source attribute, assign by order
        console.warn('Stream has no stream_source attribute, using fallback assignment');
        
        if (!gameplayStream && gameplayVideoRef.current) {
          setGameplayStream(stream);
          let existingMediaStream = gameplayVideoRef.current.srcObject as MediaStream;
          
          if (!existingMediaStream) {
            existingMediaStream = new MediaStream();
            gameplayVideoRef.current.srcObject = existingMediaStream;
          }
          
          existingMediaStream.addTrack(mediaStreamTrack);
          console.log(`Assigned ${trackKind} track to gameplay (fallback)`);
        } else if (!webcamStream && webcamVideoRef.current) {
          setWebcamStream(stream);
          let existingMediaStream = webcamVideoRef.current.srcObject as MediaStream;
          
          if (!existingMediaStream) {
            existingMediaStream = new MediaStream();
            webcamVideoRef.current.srcObject = existingMediaStream;
          }
          
          existingMediaStream.addTrack(mediaStreamTrack);
          console.log(`Assigned ${trackKind} track to webcam (fallback)`);
        }
      }
    });
  };

  // Note: We no longer need useEffect hooks to update video elements
  // because handleStreamsAdded now properly manages MediaStream tracks

  const toggleFullScreen = () => {
    const containerElement = document.getElementById('ViewerGameplayContainer');
    
    if (!document.fullscreenElement) {
      // Enter fullscreen
      if (containerElement) {
        containerElement.requestFullscreen().catch((error) => {
          console.warn('Fullscreen request failed:', error);
        });
        
        // @ts-ignore
        if (navigator.keyboard) {
          // @ts-ignore
          const keyboard = navigator.keyboard;
          keyboard.lock(['Escape']).catch(() => {});
        }
      }
    } else {
      // Exit fullscreen
      document.exitFullscreen();
    }
  };

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  return (
    <>
      <div className="view-container">
        {/* Header */}
        <div className="view-header">
          <div>
            <h2>Amazon GameLift Streams + IVS (Viewer)</h2>
            <span className="username">@{username}</span>
          </div>
          <div className="button-group">
            <button 
              className="sign-out-button" 
              onClick={() => navigate('/interactive-playtest')}
              title="Switch to Interactive Play Test mode"
            >
              <i className="bi bi-people"></i> Interactive Play Test
            </button>
            <button className="sign-out-button" onClick={signOut}>
              Sign Out
            </button>
          </div>
        </div>

        {/* Error Messages */}
        {errors.length > 0 && (
          <div>
            {errors.slice(-3).map((error, index) => (
              <div key={index} className="error-banner error-banner-flex">
                <span>{error}</span>
                <button
                  onClick={() => setErrors(prev => prev.filter((_, i) => i !== prev.length - 3 + index))}
                  className="error-dismiss-btn"
                  aria-label="Dismiss error"
                >
                  ×
                </button>
              </div>
            ))}
            {errors.length > 3 && (
              <div className="error-banner error-banner-small">
                + {errors.length - 3} more error{errors.length - 3 !== 1 ? 's' : ''}
                <button
                  onClick={() => setErrors([])}
                  className="error-clear-btn"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="view-content">
          {/* Gameplay Area (Area 1) */}
          <div className="gameplay-area">
            <div 
              className="gameplay-video-container video-container" 
              id="ViewerGameplayContainer"
              ref={gameplayContainerRef}
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onFocus={() => setIsVideoFocused(true)}
              onBlur={() => setIsVideoFocused(false)}
            >
              {/* Top Right Controls Container */}
              <div className="top-right-controls">
                {/* Broadcast Status Indicator */}
                {isConnected && (
                  <div className="broadcast-status">
                    <div className={`status-dot ${gameplayStream ? '' : 'inactive'}`}></div>
                    <span>{gameplayStream ? 'LIVE - Gameplay' : 'Waiting for gameplay...'}</span>
                  </div>
                )}

                {/* Couch Co-op Status */}
                {ENABLE_REMOTE_PLAYER_CONTROL && gameSupportsCouch && isPlayerSpawned && (
                  <div className="broadcast-status" style={{ marginLeft: '8px' }}>
                    <div className={`status-dot ${isVideoFocused ? '' : 'inactive'}`}></div>
                    <span>{isVideoFocused ? 'Controls Active' : 'Click to control'}</span>
  </div>
                )}

                {/* Expand Sidebar Button (shown when sidebar is collapsed) */}
                {isSidebarCollapsed && (
                  <button
                    className="expand-sidebar-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsSidebarCollapsed(false);
                    }}
                    title="Show chat"
                  >
                    <i className="bi bi-chat-left-text"></i>
                  </button>
                )}
              </div>

              {/* Fullscreen Toggle Button */}
              {isConnected && gameplayStream && (
                <button
                  className="fullscreen-toggle-btn"
                  onClick={toggleFullScreen}
                  title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                >
                  <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
                </button>
              )}

              {/* Subscribe Button */}
              {isConnected && gameplayStream && (
                <button
                  className="subscribe-button"
                  onClick={handleSubscribe}
                  disabled={isSubscribed}
                >
                  {isSubscribed ? (
                    <>
                      <i className="bi bi-check-circle-fill"></i>
                      <span>Subscribed</span>
                    </>
                  ) : (
                    <>
                      <i className="bi bi-bell-fill"></i>
                      <span>Subscribe</span>
                    </>
                  )}
                </button>
              )}

              {/* Gameplay Video */}
              <video
                ref={gameplayVideoRef}
                autoPlay
                playsInline
              />

              {/* Volume Control for Gameplay Stream */}
              {isConnected && gameplayStream && (
                <VolumeControl
                  mediaElement={gameplayVideoRef.current}
                  initialVolume={1}
                  className="gameplay-volume-control"
                />
              )}

              {/* Play Button Overlay - shown when not connected */}
              {!isConnecting && !isConnected && (
                <div className="play-button-overlay" onClick={connectToStage}>
                  <button className="play-button" aria-label="Start watching stream">
                    <i className="bi bi-play-circle-fill"></i>
                  </button>
                  <p className="play-button-text">Click to watch stream</p>
                </div>
              )}

              {/* Spawn Couch Co-op Player Button - small transparent button in top left */}
              {ENABLE_REMOTE_PLAYER_CONTROL && gameSupportsCouch && !isPlayerSpawned && (
                <button 
                  className="spawn-player-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    spawnCouchCoopPlayer();
                  }}
                  title="Join couch co-op (arrow keys + space to control)"
                >
                  <i className="bi bi-controller"></i>
                </button>
              )}

              {/* Loading Overlay */}
              {isConnecting && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <div>Connecting to stream...</div>
                </div>
              )}

              {/* Offline Message */}
              {!isConnecting && !gameplayStream && isConnected && (
                <div className="offline-message">
                  <h3>No Stream Available</h3>
                  <p>The player is currently offline or not broadcasting.</p>
                  <p className="offline-message-small">
                    Waiting for player to start streaming...
                  </p>
                </div>
              )}

              {/* Not Connected Message - removed since we now have play button */}
              {false && !isConnecting && !isConnected && (
                <div className="offline-message">
                  <h3>Connection Failed</h3>
                  <p>Unable to connect to the streaming stage.</p>
                  <p className="offline-message-small">
                    Please refresh the page to try again.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
            {/* Sidebar Header */}
            <div className="sidebar-header p-0 mb-3">
              <button
                className="collapse-btn border-0 bg-transparent"
                onClick={() => setIsSidebarCollapsed(true)}
                title="Hide chat"
                >
                <i className="bi bi-chevron-right"></i>
              </button>
            </div>

            {/* Webcam Area (Area 2) */}
            <div className="webcam-video-container video-container">
              {/* Broadcast Status Indicator */}
              <div className="broadcast-status">
                <div className={`status-dot ${webcamStream ? '' : 'inactive'}`}></div>
                <span>{webcamStream ? 'LIVE - Player Webcam' : 'Player Webcam Off'}</span>
              </div>

              {/* Webcam Video */}
              <video
                ref={webcamVideoRef}
                autoPlay
                playsInline
              />

              {/* Volume Control for Webcam Stream */}
              {isConnected && webcamStream && (
                <VolumeControl
                  mediaElement={webcamVideoRef.current}
                  initialVolume={1}
                  className="webcam-volume-control"
                />
              )}

              {/* Offline Message */}
              {!webcamStream && isConnected && (
                <div className="offline-message">
                  <p>Player webcam not active</p>
                </div>
              )}
            </div>

            {/* Chat Area (Area 3) */}
            <div className="chat-container">
              <ChatComponent username={username} chatClient={chatClient} isSidebarCollapsed={isSidebarCollapsed} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default ViewerView;
