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
import { generateUsername } from '../utils/usernameGenerator';
import { APPSYNC_CONFIG } from '../utils/constants';
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

  // Refs
  const gameplayVideoRef = useRef<HTMLVideoElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const stageManagerRef = useRef<IVSStageManager>(new IVSStageManager());

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <div className="gameplay-video-container video-container" id="ViewerGameplayContainer">
              {/* Top Right Controls Container */}
              <div className="top-right-controls">
                {/* Broadcast Status Indicator */}
                {isConnected && (
                  <div className="broadcast-status">
                    <div className={`status-dot ${gameplayStream ? '' : 'inactive'}`}></div>
                    <span>{gameplayStream ? 'LIVE - Gameplay' : 'Waiting for gameplay...'}</span>
                  </div>
                )}

                {/* Expand Sidebar Button (shown when sidebar is collapsed) */}
                {isSidebarCollapsed && (
                  <button
                    className="expand-sidebar-btn"
                    onClick={() => setIsSidebarCollapsed(false)}
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
                  <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-arrows-fullscreen'}`}></i>
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

              {/* Play Button Overlay - shown when not connected */}
              {!isConnecting && !isConnected && (
                <div className="play-button-overlay" onClick={connectToStage}>
                  <button className="play-button" aria-label="Start watching stream">
                    <i className="bi bi-play-circle-fill"></i>
                  </button>
                  <p className="play-button-text">Click to watch stream</p>
                </div>
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
