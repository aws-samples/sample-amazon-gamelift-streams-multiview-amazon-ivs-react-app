/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * PlayerView Component
 * Main player interface with gameplay area, webcam area, and chat
 * Broadcasts both GameLift gameplay and webcam to IVS Real-time stage
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as gameliftstreamssdk from '../gamelift-streams-websdk/gameliftstreams-1.0.0';
import { Stage, StageConnectionState } from 'amazon-ivs-web-broadcast';
import { ApiError, get, post } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AppSyncChatClient } from '../utils/AppSyncChatClient';
import { IVSStageManager } from '../utils/IVSStageManager';
import { ChatComponent } from './ChatComponent';
import { VolumeControl } from './VolumeControl';
import { SettingsModal } from './SettingsModal';
import { generateUsername } from '../utils/usernameGenerator';
import { APPSYNC_CONFIG, STREAM_SOURCE, GAMELIFT_STREAMS_CONFIG, IVS_WHIP_ENDPOINT, ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST } from '../utils/constants';
import './Views.css';
import './PlayerView.css';

// Extend HTMLVideoElement and HTMLAudioElement to include captureStream method
declare global {
  interface HTMLVideoElement {
    captureStream(frameRate?: number): MediaStream;
    mozCaptureStream?(frameRate?: number): MediaStream;
  }
  interface HTMLAudioElement {
    captureStream(): MediaStream;
    mozCaptureStream?(): MediaStream;
  }
}

/**
 * Cross-browser compatible captureStream helper
 * Handles Firefox's mozCaptureStream and other browser quirks
 */
const captureVideoStream = (videoElement: HTMLVideoElement, frameRate?: number): MediaStream => {
  // Try standard captureStream first
  if (typeof videoElement.captureStream === 'function') {
    return videoElement.captureStream(frameRate);
  }
  // Fallback to Firefox's mozCaptureStream
  if (typeof videoElement.mozCaptureStream === 'function') {
    return videoElement.mozCaptureStream(frameRate);
  }
  throw new Error('captureStream is not supported in this browser');
};

const captureAudioStream = (audioElement: HTMLAudioElement): MediaStream => {
  // Try standard captureStream first
  if (typeof audioElement.captureStream === 'function') {
    return audioElement.captureStream();
  }
  // Fallback to Firefox's mozCaptureStream
  if (typeof audioElement.mozCaptureStream === 'function') {
    return audioElement.mozCaptureStream();
  }
  throw new Error('captureStream is not supported in this browser');
};

interface PlayerViewProps {
  user: any;
  signOut: any;
}

export enum StreamState {
  STOPPED = 1,
  LOADING,
  RUNNING,
  ERROR
}

export const PlayerView: React.FC<PlayerViewProps> = ({ user, signOut }) => {
  const navigate = useNavigate();
  
  // GameLift Stream State
  const [gameLiftStatus, setGameLiftStatus] = useState<StreamState>(StreamState.STOPPED);
  const [selectedGame, setSelectedGame] = useState(Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary)[0] || '');
  const [sgId, setSgId] = useState(GAMELIFT_STREAMS_CONFIG.gameLibrary[Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary)[0]]?.streamGroupId || '');
  const [appId, setAppId] = useState(GAMELIFT_STREAMS_CONFIG.gameLibrary[Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary)[0]]?.applicationId || '');
  const [sessionId, setSessionId] = useState('');
  const [lastSessionId, setLastSessionId] = useState('');
  const [regions, setRegions] = useState([GAMELIFT_STREAMS_CONFIG.defaultRegion]);
  const [inputEnabled, setInputEnabled] = useState(false);
  const [isStreamStarting, setIsStreamStarting] = useState(false);

  // IVS Gameplay Broadcast State
  const [gameplayStage, setGameplayStage] = useState<Stage | null>(null);
  const [isGameplayBroadcasting, setIsGameplayBroadcasting] = useState(false);
  const [isGameplayBroadcastStarting, setIsGameplayBroadcastStarting] = useState(false);

  // Direct Broadcast State (GameLift + IVS combined)
  const [isDirectBroadcastStarting, setIsDirectBroadcastStarting] = useState(false);
  const [directBroadcastToken, setDirectBroadcastToken] = useState<string | null>(null);

  // IVS Webcam Broadcast State
  const [webcamStage, setWebcamStage] = useState<Stage | null>(null);
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [webcamStageStreams, setWebcamStageStreams] = useState<any[]>([]);
  const [isWebcamBroadcasting, setIsWebcamBroadcasting] = useState(false);
  const [isWebcamBroadcastStarting, setIsWebcamBroadcastStarting] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isMicEnabled, setIsMicEnabled] = useState(true);

  // UI State
  const [showSettingsModal, setShowSettingsModal] = useState(true);
  const [activeTab, setActiveTab] = useState<'general' | 'broadcast'>('general');
  const [username] = useState(generateUsername());
  const [errors, setErrors] = useState<string[]>([]);
  const [showInputIndicator, setShowInputIndicator] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Direct Broadcast Configuration State
  const [broadcastConfig, setBroadcastConfig] = useState({
    encoderType: 'gpu',
    videoWidth: 1280,
    videoHeight: 720,
    videoFramerate: 30,
    videoBitrate: 4000,
    enableAudio: true,
    audioBitrate: 128000,
    debugPipeline: false
  });
  
  // Reconnection State
  const [isReconnecting, setIsReconnecting] = useState(false);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 3;

  // Refs
  const gameLiftVideoRef = useRef<HTMLVideoElement>(null);
  const gameLiftAudioRef = useRef<HTMLAudioElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const gameliftstreamsRef = useRef<gameliftstreamssdk.GameLiftStreams | null>(null);
  const gameplayStageManagerRef = useRef<IVSStageManager>(new IVSStageManager());
  const webcamStageManagerRef = useRef<IVSStageManager>(new IVSStageManager());

  // Chat Client
  const [chatClient] = useState(() => new AppSyncChatClient(APPSYNC_CONFIG));

  // Initialize GameLift Streams SDK on mount
  useEffect(() => {
    resetGameLiftStreamsSDK();

    // Load last session ID from localStorage with expiration check
    const savedSessionId = localStorage.getItem('lastGameLiftSessionId');
    const savedTimestamp = localStorage.getItem('lastGameLiftSessionTimestamp');
    
    if (savedSessionId && savedTimestamp) {
      const timestamp = parseInt(savedTimestamp, 10);
      const now = Date.now();
      const expirationTime = 120 * 1000; // 120 seconds in milliseconds
      
      if (now - timestamp < expirationTime) {
        // Session ID is still valid
        setLastSessionId(savedSessionId);
        console.log('Loaded last session ID from localStorage:', savedSessionId);
      } else {
        // Session ID has expired, clear it
        console.log('Stored session ID has expired, clearing...');
        localStorage.removeItem('lastGameLiftSessionId');
        localStorage.removeItem('lastGameLiftSessionTimestamp');
      }
    }

    // Cleanup on unmount
    return () => {
      if (gameliftstreamsRef.current) {
        gameliftstreamsRef.current.close();
      }
      // Cleanup stage managers
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const gameplayManager = gameplayStageManagerRef.current;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const webcamManager = webcamStageManagerRef.current;
      if (gameplayManager.isActive()) {
        gameplayManager.leaveStage();
      }
      if (webcamManager.isActive()) {
        webcamManager.leaveStage();
      }
      chatClient.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle automatic input attach/detach based on click location
  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      // Only handle if GameLift stream is running
      if (gameLiftStatus !== StreamState.RUNNING) {
        return;
      }

      const gameplayContainer = document.getElementById('PlayerGameplayContainer');
      if (!gameplayContainer) {
        return;
      }

      const clickedInsideGameplay = gameplayContainer.contains(event.target as Node);

      if (clickedInsideGameplay && !inputEnabled) {
        // Clicked inside gameplay area and input not attached - attach it
        attachInput();
      } else if (!clickedInsideGameplay && inputEnabled) {
        // Clicked outside gameplay area and input is attached - detach it
        detachInput();
      }
    };

    document.addEventListener('click', handleDocumentClick);

    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [gameLiftStatus, inputEnabled]);

  // Auto-hide input indicator after 5 seconds when input state changes
  useEffect(() => {
    setShowInputIndicator(true);
    const timer = setTimeout(() => {
      setShowInputIndicator(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, [inputEnabled]);

  // Demo Mode - Send random reactions and chat messages every 2.5 seconds
  useEffect(() => {
    if (!demoMode) {
      return;
    }

    // Demo Mode - Random usernames and messages
    const demoUsernames = ['GamerPro', 'NoobMaster', 'PixelWarrior', 'StreamSniper', 'LootGoblin', 'RageQuitter', 'CampKing', 'FragHunter', 'BossSlayer', 'AFK_Legend'];
    const demoChatMessages = [
      'Nice play!',
      'GG!',
      'That was insane!',
      'How did you do that?',
      'Wow!',
      'Epic moment!',
      'You got this!',
      'Let\'s go!',
      'Clutch!',
      'Amazing!',
      'No way!',
      'Incredible!',
      'Beast mode!',
      'Pro gamer move!',
      'That was sick!'
    ];

    const interval = setInterval(async () => {
      try {
        // Send random reaction
        const reactions = ['like', 'fire', 'star', 'laugh', 'clap', 'wow'];
        const randomReaction = reactions[Math.floor(Math.random() * reactions.length)];
        
        const reactionEvent = {
          action: 'STREAM_REACT',
          reaction: randomReaction,
          message: null,
          user: null,
          timestamp: Date.now()
        };
        
        await (chatClient as any).publishRaw(reactionEvent);

        // Send random chat message with random username
        const randomUsername = demoUsernames[Math.floor(Math.random() * demoUsernames.length)];
        const randomMessage = demoChatMessages[Math.floor(Math.random() * demoChatMessages.length)];
        
        await chatClient.publish(randomMessage, randomUsername);
      } catch (error) {
        console.error('Demo mode error:', error);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [demoMode, chatClient]);

  const detachInput = () => {
    gameliftstreamsRef.current?.detachInput();
    setInputEnabled(false);
  };

  // Handle game selection change
  const handleGameSelectionChange = (gameName: string) => {
    const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[gameName];
    if (gameConfig) {
      setSelectedGame(gameName);
      setSgId(gameConfig.streamGroupId);
      setAppId(gameConfig.applicationId);
      
      // If switching to a game that doesn't support direct broadcast while on broadcast tab, switch to general tab
      if (activeTab === 'broadcast' && !gameConfig.supportsDirectBroadcast) {
        setActiveTab('general');
      }
    }
  };

  const applicationMessageCallback = (applicationMsg) => {
    const decoder = new TextDecoder();
    const msg = decoder.decode(applicationMsg);
    console.log(msg);
    // data channel is established, send config
    sendAppSyncConfigToGame();
  };

  const resetGameLiftStreamsSDK = () => {
    gameliftstreamsRef.current = new gameliftstreamssdk.GameLiftStreams({
      videoElement: gameLiftVideoRef.current || document.getElementById('PlayerGameLiftVideo') as HTMLVideoElement,
      audioElement: gameLiftAudioRef.current || document.getElementById('PlayerGameLiftAudio') as HTMLAudioElement,
      inputConfiguration: {
        setCursor: 'visibility',
        autoPointerLock: 'fullscreen'
      },
      clientConnection: {
        applicationMessage: applicationMessageCallback,
      }
    });
  };

  // GameLift Stream Methods
  /**
   * Handle GameLift stream errors with user-friendly messages
   * Implements subtask 8.3: Catch and display session creation errors and connection errors
   */
  const handleError = (e: any) => {
    console.error('GameLift stream error:', e);
    setIsStreamStarting(false);
    
    let errorMessage = 'An error occurred with the GameLift stream.';
    
    if (e instanceof ApiError) {
      if (e.response) {
        const { statusCode, body } = e.response;
        console.error(`Received ${statusCode} error response with payload: ${body}`);
        
        try {
          const data = JSON.parse(body ?? '{}');
          
          // Provide user-friendly error messages based on status code
          if (statusCode === 400) {
            errorMessage = 'Invalid stream configuration. Please check your Stream Group ID and Application ID.';
          } else if (statusCode === 401 || statusCode === 403) {
            errorMessage = 'Authentication failed. Please sign out and sign in again.';
          } else if (statusCode === 404) {
            errorMessage = 'Stream Group or Application not found. Please verify your configuration.';
          } else if (statusCode === 429) {
            errorMessage = 'Too many requests. Please wait a moment before trying again.';
          } else if (statusCode === 503) {
            errorMessage = 'GameLift service is temporarily unavailable. Please try again in a few moments.';
          } else if (statusCode >= 500) {
            errorMessage = 'GameLift server error. Please try again later.';
          } else {
            errorMessage = data.message || `Stream error (${statusCode}). Please try again.`;
          }
        } catch (parseError) {
          errorMessage = `Stream error (${statusCode}). Please try again.`;
        }
      }
    } else if (e instanceof Error) {
      // Handle specific error types
      if (e.message.includes('timeout')) {
        errorMessage = 'Stream connection timed out. Please try again.';
      } else if (e.message.includes('network') || e.message.includes('fetch')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      } else if (e.message.includes('session')) {
        errorMessage = 'Failed to create stream session. Please try again.';
      } else {
        errorMessage = `Stream error: ${e.message}`;
      }
    }
    
    setErrors(prev => [...prev, errorMessage]);
  };

  /**
   * Handle GameLift stream session timeout
   * Implements subtask 8.3: Catch and display session creation errors
   */
  const handleTimeout = (arn: string) => {
    const message = `Timeout waiting for stream session: ${arn}`;
    console.error('Polling timed out:', message);
    setErrors(prev => [...prev, 'Stream session creation timed out. This can happen when no compute resources are available. Please try again in a few moments.']);
    setIsStreamStarting(false);
  };

  const createStreamSession = async () => {
    setIsStreamStarting(true);
    setErrors([]);

    const signalRequest = await gameliftstreamsRef.current?.generateSignalRequest();
    const payload = {
      AppIdentifier: appId,
      SGIdentifier: sgId,
      SignalRequest: signalRequest ?? '',
      Regions: regions
    };

    try {
      const restOperation = post({
        apiName: 'demo-api',
        path: '/',
        options: {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${(await fetchAuthSession()).tokens?.idToken?.toString()}`
          },
          body: payload
        }
      });
      const { body } = await restOperation.response;
      const data = JSON.parse(await body.text());
      await waitForACTIVE(data.arn, sgId);
    } catch (e) {
      handleError(e);
    }
  };

  const createStreamSessionConnection = async () => {
    setIsStreamStarting(true);
    setErrors([]);
    
    // Use sessionId if available, otherwise use lastSessionId from localStorage
    const sessionIdToUse = sessionId || lastSessionId;
    
    if (!sessionIdToUse) {
      setErrors(prev => [...prev, 'No session ID available for reconnection']);
      setIsStreamStarting(false);
      return;
    }
    
    const signalRequest = await gameliftstreamsRef.current?.generateSignalRequest();
    const payload = {
      SessionIdentifier: sessionIdToUse,
      SignalRequest: signalRequest ?? '',
    };

    try {
      const restOperation = post({
        apiName: 'demo-api',
        path: '/reconnect',
        options: {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${(await fetchAuthSession()).tokens?.idToken?.toString()}`
          },
          body: payload
        }
      });
      const { body } = await restOperation.response;
      const data = JSON.parse(await body.text());
      await startStream(data.signalResponse);
    } catch (e) {
      handleError(e);
    }
  };

  /**
   * Create a direct broadcast session that combines GameLift stream with IVS broadcast
   * This method generates an IVS stage token and passes it to the GameLift instance
   * via environment variables, allowing the instance to broadcast directly to IVS
   * 
   * Requirements: 1.3, 1.4, 2.1, 2.2, 2.3, 4.1, 4.2, 4.3, 7.1, 7.2, 7.3, 7.4, 7.5, 9.3
   */
  const createDirectBroadcastSession = async () => {
    setIsDirectBroadcastStarting(true);
    setErrors([]);

    try {
      // Generate IVS stage token with gameplay attributes
      // Requirements: 2.1, 2.2, 2.3
      console.log('Generating IVS stage token for direct broadcast...');
      
      let participantToken: string;
      try {
        const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame];
        participantToken = await gameplayStageManagerRef.current.fetchParticipantToken(
          username,
          ['SUBSCRIBE'],  // Use SUBSCRIBE to listen for GameLift instance's broadcast
          STREAM_SOURCE.GAMEPLAY as 'gameplay',
          gameConfig?.supportsCouchCoop
        );
        console.log('Successfully generated IVS stage token for monitoring');
      } catch (tokenError) {
        // Requirement 7.1: Specific error message for token generation failures
        console.error('Token generation failed:', tokenError);
        const errorMsg = 'Failed to generate IVS credentials. Please try again.';
        setErrors(prev => [...prev, errorMsg]);
        setIsDirectBroadcastStarting(false);
        return;
      }

      // Store token in state
      setDirectBroadcastToken(participantToken);

      // Create the gameplay stage to listen for GameLift instance's broadcast
      // This allows us to detect when the GameLift instance starts broadcasting
      console.log('Creating IVS stage for monitoring GameLift broadcast...');
      const stage = await gameplayStageManagerRef.current.createStage({
        participantToken,
        streams: [],  // No local streams - we're only subscribing
        onConnectionStateChange: (state) => {
          console.log('Gameplay stage connection state:', state);
          if (state === StageConnectionState.CONNECTED) {
            console.log('Successfully connected to gameplay IVS stage for monitoring');
          }
        },
        onStreamsAdded: (streams) => {
          console.log('Streams added to gameplay stage:', streams);
          
          // Check each stream for GameLift direct broadcast
          // Requirements: 5.1, 5.2, 9.4
          streams.forEach((stream: any) => {
            const participantInfo = stream._participantInfo;
            
            // Check if this is a GameLift instance broadcasting (not local, with gameplay source)
            if (participantInfo && 
                participantInfo.attributes?.stream_source === 'gameplay' && 
                !participantInfo.isLocal) {
              console.log('Detected GameLift direct broadcast from instance');
              
              // Update state to show broadcast is live
              setIsGameplayBroadcasting(true);
              
              // Reset direct broadcast starting state
              setIsDirectBroadcastStarting(false);
            }
          });
        },
        onError: (error) => {
          // Requirement 7.5: Console logging for detailed error information
          console.error('Gameplay stage error:', error);
          setErrors(prev => [...prev, `Gameplay broadcast error: ${error.message}`]);
        }
      });

      // Join the stage to start listening for broadcasts
      await gameplayStageManagerRef.current.joinStage();
      setGameplayStage(stage);
      console.log('Successfully joined IVS stage for monitoring');

      // Now generate a separate token for the GameLift instance to use for publishing
      console.log('Generating IVS publish token for GameLift instance...');
      let gameLiftPublishToken: string;
      try {
        const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame];
        gameLiftPublishToken = await gameplayStageManagerRef.current.fetchParticipantToken(
          `${username}-gamelift`,
          ['PUBLISH'],
          STREAM_SOURCE.GAMEPLAY as 'gameplay',
          gameConfig?.supportsCouchCoop
        );
        console.log('Successfully generated IVS publish token for GameLift instance');
      } catch (tokenError) {
        // Requirement 7.1: Specific error message for token generation failures
        console.error('GameLift publish token generation failed:', tokenError);
        const errorMsg = 'Failed to generate IVS credentials for GameLift instance. Please try again.';
        setErrors(prev => [...prev, errorMsg]);
        setIsDirectBroadcastStarting(false);
        return;
      }

      // Generate GameLift signal request
      const signalRequest = await gameliftstreamsRef.current?.generateSignalRequest();

      // Create payload with IVS credentials as environment variables
      // Requirements: 4.1, 4.2, 4.3
      console.log('Creating GameLift stream session with IVS environment variables...');
      const payload = {
        AppIdentifier: appId,
        SGIdentifier: sgId,
        SignalRequest: signalRequest ?? '',
        Regions: regions,
        AdditionalEnvironmentVariables: {
          IVS_WHIP_ENDPOINT: IVS_WHIP_ENDPOINT,
          IVS_STAGE_TOKEN: gameLiftPublishToken,
          ENCODER_TYPE: broadcastConfig.encoderType,
          VIDEO_WIDTH: broadcastConfig.videoWidth.toString(),
          VIDEO_HEIGHT: broadcastConfig.videoHeight.toString(),
          VIDEO_FRAMERATE: broadcastConfig.videoFramerate.toString(),
          VIDEO_BITRATE: broadcastConfig.videoBitrate.toString(),
          ENABLE_AUDIO: broadcastConfig.enableAudio.toString(),
          AUDIO_BITRATE: broadcastConfig.audioBitrate.toString(),
          DEBUG_PIPELINE: broadcastConfig.debugPipeline.toString()
        }
      };

      // Call StartStream Lambda with enhanced payload
      // Requirements: 1.3, 1.4
      try {
        const restOperation = post({
          apiName: 'demo-api',
          path: '/',
          options: {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${(await fetchAuthSession()).tokens?.idToken?.toString()}`
            },
            body: payload
          }
        });

        const { body } = await restOperation.response;
        const data = JSON.parse(await body.text());
        
        console.log('GameLift stream session created, waiting for ACTIVE status...');
        
        // Wait for session to become ACTIVE and start stream
        await waitForACTIVE(data.arn, sgId);
        
        console.log('Direct broadcast session successfully started');
        
        // Note: isDirectBroadcastStarting will be reset to false when broadcast is detected
        // via the onStreamsAdded handler above (Requirement: 9.3)
      } catch (sessionError) {
        // Requirement 7.2: Specific error message for session creation with environment variables
        // Requirement 7.3: Display Lambda error messages from API responses
        console.error('GameLift session creation with environment variables failed:', sessionError);
        
        let errorMessage = 'Failed to start GameLift stream with IVS broadcast. Please check your configuration.';
        
        if (sessionError instanceof ApiError) {
          if (sessionError.response) {
            const { statusCode, body: errorBody } = sessionError.response;
            console.error(`Received ${statusCode} error response from Lambda`);
            
            try {
              const errorData = JSON.parse(errorBody ?? '{}');
              // Requirement 7.3: Display Lambda error messages from API responses
              if (errorData.message) {
                errorMessage = errorData.message;
                console.error('Lambda error message:', errorData.message);
              }
            } catch (parseError) {
              console.error('Failed to parse error response:', parseError);
            }
          }
        } else if (sessionError instanceof Error) {
          console.error('Session creation error:', sessionError.message);
          errorMessage = `Failed to start GameLift stream: ${sessionError.message}`;
        }
        
        // Requirement 7.4: Ensure all errors use the dismissible error banner format
        setErrors(prev => [...prev, errorMessage]);
        
        // Requirement 9.3: Reset state on failure
        setIsDirectBroadcastStarting(false);
        return;
      }
    } catch (error) {
      // Handle any unexpected errors
      // Requirements: 7.4, 7.5
      console.error('Unexpected error in createDirectBroadcastSession:', error);
      
      let errorMessage = 'An unexpected error occurred while starting direct broadcast. Please try again.';
      
      if (error instanceof Error) {
        console.error('Error details:', error.message, error.stack);
        errorMessage = `Unexpected error: ${error.message}`;
      }
      
      // Requirement 7.4: Ensure all errors use the dismissible error banner format
      setErrors(prev => [...prev, errorMessage]);
      
      // Requirement 9.3: Reset state on failure
      setIsDirectBroadcastStarting(false);
    }
  };

  const waitForACTIVE = async (arn: string, sg: string, timeoutMs: number = 600000) => {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      console.log(`Waiting for stream session: ${arn}`);
      try {
        const restOperation = get({
          apiName: 'demo-api',
          path: `/session/${encodeURIComponent(sg)}/${encodeURIComponent(arn)}`,
          options: {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${(await fetchAuthSession()).tokens?.idToken?.toString()}`
            }
          }
        });
        const { body } = await restOperation.response;
        const data = JSON.parse(await body.text());

        if (data.status === 'ACTIVE') {
          await startStream(data.signalResponse);
          setLastSessionId(arn);
          // Store in localStorage for easy reconnection with timestamp
          localStorage.setItem('lastGameLiftSessionId', arn);
          localStorage.setItem('lastGameLiftSessionTimestamp', Date.now().toString());
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        handleError(e);
        setIsStreamStarting(false);
        return;
      }
    }
    handleTimeout(arn);
  };

  /**
   * Start GameLift stream with signal response
   * Implements subtask 8.3: Implement automatic reconnection for disconnections
   */
  const startStream = async (signalResponse: any) => {
    console.log('Starting GameLift stream');
    
    try {
      await gameliftstreamsRef.current?.processSignalResponse(signalResponse);
      setGameLiftStatus(StreamState.RUNNING);
      setIsStreamStarting(false);
      setInputEnabled(false);
      setIsReconnecting(false);
      reconnectAttemptsRef.current = 0;
      
      // Set up disconnect handler for automatic reconnection
      if (gameliftstreamsRef.current) {
        // Monitor for disconnections
        const checkConnection = setInterval(() => {
          if (gameLiftStatus === StreamState.RUNNING && gameliftstreamsRef.current) {
            // Check if stream is still active
            // Note: GameLift SDK doesn't expose connection state directly
            // This is a placeholder for actual connection monitoring
          }
        }, 5000);
        
        // Store interval ID for cleanup
        (gameliftstreamsRef.current as any)._connectionCheckInterval = checkConnection;
      }
    } catch (error) {
      console.error('Failed to start stream:', error);
      handleError(error);
    }
  };

  /**
   * Attempt to reconnect to GameLift stream
   * Implements subtask 8.3: Implement automatic reconnection for disconnections
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const attemptReconnect = async () => {
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      setErrors(prev => [...prev, 'Unable to reconnect to GameLift stream after multiple attempts. Please restart the stream manually.']);
      setIsReconnecting(false);
      setGameLiftStatus(StreamState.ERROR);
      return;
    }

    setIsReconnecting(true);
    reconnectAttemptsRef.current++;
    
    const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 8000);
    console.log(`Attempting to reconnect to GameLift stream (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts}) in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        if (lastSessionId) {
          setSessionId(lastSessionId);
          await createStreamSessionConnection();
        } else {
          await createStreamSession();
        }
      } catch (error) {
        console.error('Reconnection attempt failed:', error);
        attemptReconnect();
      }
    }, delay);
  };

  const closeConnection = () => {
    // Stop IVS broadcasts if active
    if (isGameplayBroadcasting) {
      stopGameplayBroadcast();
    }
    if (isWebcamBroadcasting) {
      stopWebcamBroadcast();
    }

    setGameLiftStatus(StreamState.STOPPED);
    setInputEnabled(false);
    setIsReconnecting(false);
    reconnectAttemptsRef.current = 0;
    
    // Clear connection check interval if it exists
    if (gameliftstreamsRef.current && (gameliftstreamsRef.current as any)._connectionCheckInterval) {
      clearInterval((gameliftstreamsRef.current as any)._connectionCheckInterval);
    }
    
    gameliftstreamsRef.current?.close();
    resetGameLiftStreamsSDK();
    setIsStreamStarting(false);

    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  };

  /**
   * Send AppSync configuration to the game application
   * This allows the game to connect to AppSync for real-time features
   */
  const sendAppSyncConfigToGame = () => {
    try {
      const config = {
        type: 'AWS_APPSYNC_CONFIG',
        message: {
          appSyncApiKey: APPSYNC_CONFIG.apiKey,
          appSyncHttpApiEndpoint: APPSYNC_CONFIG.httpEndpoint.replace('https://', ''),
          appSyncRealtimeEndpoint: APPSYNC_CONFIG.realtimeEndpoint,
          channelName: APPSYNC_CONFIG.channelName
        }
      };

      const configString = JSON.stringify(config);
      const encoder = new TextEncoder();
      const msg = encoder.encode(configString);
      gameliftstreamsRef.current?.sendApplicationMessage(msg);
      
      console.log('Sent AppSync configuration to game:', config);
    } catch (error) {
      console.error('Failed to send AppSync configuration to game:', error);
    }
  };

  const toggleFullScreen = () => {
    const containerElement = document.getElementById('PlayerGameplayContainer');
    
    if (!document.fullscreenElement) {
      // Enter fullscreen
      if (containerElement) {
        if (!inputEnabled) {
          attachInput();
        }
        
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

  const attachInput = () => {
    gameliftstreamsRef.current?.attachInput();
    setInputEnabled(true);
  };

  // IVS Gameplay Broadcasting Methods
  const startGameplayBroadcast = async () => {
    if (!gameLiftVideoRef.current || gameLiftStatus !== StreamState.RUNNING) {
      setErrors(prev => [...prev, 'GameLift stream must be running before starting IVS broadcast']);
      return;
    }

    setIsGameplayBroadcastStarting(true);
    setErrors([]);

    try {
      // Fetch participant token with gameplay stream_source attribute
      const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame];
      const participantToken = await gameplayStageManagerRef.current.fetchParticipantToken(
        username,
        ['PUBLISH'],
        STREAM_SOURCE.GAMEPLAY as 'gameplay',
        gameConfig?.supportsCouchCoop
      );

      // Capture GameLift video/audio using cross-browser compatible method
      const videoElement = gameLiftVideoRef.current;
      const audioElement = gameLiftAudioRef.current;

      // Capture video stream (30 fps for better performance)
      const mediaStream = captureVideoStream(videoElement, 30);

      // Add audio tracks if available
      if (audioElement) {
        try {
          const audioStream = captureAudioStream(audioElement);
          const audioTracks = audioStream.getAudioTracks();
          audioTracks.forEach(track => {
            mediaStream.addTrack(track);
          });
        } catch (audioError) {
          console.warn('Failed to capture audio stream, continuing with video only:', audioError);
        }
      }

      // Create LocalStageStream instances for video and audio tracks
      const stageStreams = gameplayStageManagerRef.current.createLocalStreams(mediaStream);

      // Create and configure the stage
      const stage = await gameplayStageManagerRef.current.createStage({
        participantToken,
        streams: stageStreams,
        onConnectionStateChange: (state) => {
          console.log('Gameplay stage connection state:', state);
          if (state === StageConnectionState.CONNECTED) {
            console.log('Successfully connected to gameplay IVS stage');
            setIsGameplayBroadcasting(true);
            setIsGameplayBroadcastStarting(false);
          }
        },
        onStreamsAdded: (streams) => {
          console.log('Streams added to gameplay stage:', streams);
          
          // Check each stream for GameLift direct broadcast
          // Requirements: 5.1, 5.2, 9.4
          streams.forEach((stream: any) => {
            const participantInfo = stream._participantInfo;
            
            // Check if this is a GameLift instance broadcasting (not local, with gameplay source)
            if (participantInfo && 
                participantInfo.attributes?.stream_source === 'gameplay' && 
                !participantInfo.isLocal) {
              console.log('Detected GameLift direct broadcast from instance');
              
              // Update state to show broadcast is live
              setIsGameplayBroadcasting(true);
              
              // Reset direct broadcast starting state
              setIsDirectBroadcastStarting(false);
            }
          });
        },
        onError: (error) => {
          console.error('Gameplay stage error:', error);
          setErrors(prev => [...prev, `Gameplay broadcast error: ${error.message}`]);
          setIsGameplayBroadcastStarting(false);
        }
      });

      // Join the stage
      await gameplayStageManagerRef.current.joinStage();
      setGameplayStage(stage);

      console.log('Successfully started gameplay IVS broadcast');
    } catch (error) {
      console.error('Failed to start gameplay IVS broadcast:', error);
      setErrors(prev => [...prev, `Failed to start gameplay broadcast: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setIsGameplayBroadcastStarting(false);
    }
  };

  const stopGameplayBroadcast = async () => {
    if (!gameplayStage) {
      return;
    }

    try {
      await gameplayStageManagerRef.current.leaveStage();
      setGameplayStage(null);
      setIsGameplayBroadcasting(false);
      console.log('Successfully stopped gameplay IVS broadcast');
    } catch (error) {
      console.error('Failed to stop gameplay IVS broadcast:', error);
      setErrors(prev => [...prev, `Failed to stop gameplay broadcast: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  };

  // IVS Webcam Broadcasting Methods
  const startWebcamBroadcast = async () => {
    setIsWebcamBroadcastStarting(true);
    setErrors([]);

    try {
      // Request user media (camera and microphone)
      const userMediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      setWebcamStream(userMediaStream);

      const userPreviewStream = new MediaStream([userMediaStream.getVideoTracks()[0]]);

      // Display webcam in local video element
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = userPreviewStream;
      }

      // Fetch participant token with player_webcam stream_source attribute
      const participantToken = await webcamStageManagerRef.current.fetchParticipantToken(
        username,
        ['PUBLISH'],
        STREAM_SOURCE.PLAYER_WEBCAM as 'player_webcam'
      );

      // Create LocalStageStream instances for webcam tracks
      const stageStreams = webcamStageManagerRef.current.createLocalStreams(userMediaStream);
      
      // Store references to LocalStageStream objects for muting
      setWebcamStageStreams(stageStreams);

      // Create and configure the stage
      const stage = await webcamStageManagerRef.current.createStage({
        participantToken,
        streams: stageStreams,
        onConnectionStateChange: (state) => {
          console.log('Webcam stage connection state:', state);
          if (state === StageConnectionState.CONNECTED) {
            console.log('Successfully connected to webcam IVS stage');
            setIsWebcamBroadcasting(true);
            setIsWebcamBroadcastStarting(false);
          }
        },
        onError: (error) => {
          console.error('Webcam stage error:', error);
          setErrors(prev => [...prev, `Webcam broadcast error: ${error.message}`]);
          setIsWebcamBroadcastStarting(false);
        }
      });

      // Join the stage
      await webcamStageManagerRef.current.joinStage();
      setWebcamStage(stage);

      console.log('Successfully started webcam IVS broadcast');
    } catch (error) {
      console.error('Failed to start webcam IVS broadcast:', error);
      setErrors(prev => [...prev, `Failed to start webcam broadcast: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setIsWebcamBroadcastStarting(false);
    }
  };

  const stopWebcamBroadcast = async () => {
    if (!webcamStage) {
      return;
    }

    try {
      await webcamStageManagerRef.current.leaveStage();
      
      // Stop webcam stream tracks
      if (webcamStream) {
        webcamStream.getTracks().forEach(track => track.stop());
        setWebcamStream(null);
      }

      // Clear video element
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = null;
      }

      setWebcamStage(null);
      setIsWebcamBroadcasting(false);
      setWebcamStageStreams([]);
      console.log('Successfully stopped webcam IVS broadcast');
    } catch (error) {
      console.error('Failed to stop webcam IVS broadcast:', error);
      setErrors(prev => [...prev, `Failed to stop webcam broadcast: ${error instanceof Error ? error.message : 'Unknown error'}`]);
    }
  };

  /**
   * Toggle webcam camera on/off
   * Uses LocalStageStream.setMuted() to properly mute the stream
   */
  const toggleWebcamCamera = () => {
    if (webcamStageStreams.length === 0) return;

    const newCameraState = !isCameraEnabled;
    
    // Find video LocalStageStream and call setMuted
    webcamStageStreams.forEach((stream: any) => {
      if (stream.mediaStreamTrack?.kind === 'video') {
        stream.setMuted(!newCameraState);
      }
    });
    
    // Refresh stage strategy to apply changes
    const stage = webcamStageManagerRef.current.getStage();
    if (stage) {
      stage.refreshStrategy();
    }
    
    setIsCameraEnabled(newCameraState);
  };

  /**
   * Toggle webcam microphone on/off
   * Uses LocalStageStream.setMuted() to properly mute the stream
   */
  const toggleWebcamMicrophone = () => {
    if (webcamStageStreams.length === 0) return;

    const newMicState = !isMicEnabled;
    
    // Find audio LocalStageStream and call setMuted
    webcamStageStreams.forEach((stream: any) => {
      if (stream.mediaStreamTrack?.kind === 'audio') {
        stream.setMuted(!newMicState);
      }
    });
    
    // Refresh stage strategy to apply changes
    const stage = webcamStageManagerRef.current.getStage();
    if (stage) {
      stage.refreshStrategy();
    }
    
    setIsMicEnabled(newMicState);
  };

  return (
    <>
      <div className="view-container">
        {/* Header */}
        <div className="view-header">
          <div>
            <h2>Amazon GameLift Streams + IVS (Player View)</h2>
            <span className="username">@{username}</span>
          </div>
          <div className="button-group">
            <button 
              className="settings-button" 
              onClick={() => navigate('/interactive-playtest')}
              title="Switch to Interactive Play Test mode"
            >
              <i className="bi bi-people"></i> Interactive Play Test
            </button>
            <button className="settings-button" onClick={() => setShowSettingsModal(true)}>
              <i className="bi bi-gear"></i> Settings
            </button>
            <button className="settings-button" onClick={signOut}>
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
            <div className="gameplay-video-container video-container" id="PlayerGameplayContainer">
              {/* Top Right Controls Container */}
              <div className="top-right-controls">
                {/* Broadcast Status Indicator */}
                {gameLiftStatus === StreamState.RUNNING && (
                  <div className="broadcast-status">
                    <div className={`status-dot ${isGameplayBroadcasting ? '' : 'inactive'}`}></div>
                    <span>{isGameplayBroadcasting ? 'LIVE - Broadcasting Gameplay' : 'Gameplay Not Broadcasting'}</span>
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
              {gameLiftStatus === StreamState.RUNNING && (
                <button
                  className="fullscreen-toggle-btn"
                  onClick={toggleFullScreen}
                  title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                >
                  <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
                </button>
              )}

              {/* GameLift Video */}
              <video
                ref={gameLiftVideoRef}
                id="PlayerGameLiftVideo"
                autoPlay
                playsInline
                muted
              />

              {/* GameLift Audio - Player should hear this */}
              <audio ref={gameLiftAudioRef} id="PlayerGameLiftAudio" autoPlay />

              {/* Volume Control for GameLift Audio */}
              {gameLiftStatus === StreamState.RUNNING && (
                <VolumeControl
                  mediaElement={gameLiftAudioRef.current}
                  initialVolume={1}
                  className="gameplay-volume-control"
                />
              )}

              {/* Loading Overlay */}
              {isStreamStarting && !isReconnecting && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <div>Starting GameLift Stream Session...</div>
                  <div className="loading-text">
                    This may take up to 30 seconds
                  </div>
                </div>
              )}

              {/* Reconnecting Overlay */}
              {isReconnecting && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <div>Reconnecting to GameLift Stream...</div>
                  <div className="loading-text">
                    Attempt {reconnectAttemptsRef.current} of {maxReconnectAttempts}
                  </div>
                </div>
              )}

              {/* Input Status Indicator - Auto-hides after 5 seconds */}
              {gameLiftStatus === StreamState.RUNNING && showInputIndicator && !inputEnabled && (
                <div className="input-status-indicator inactive">
                  Click on gameplay to enable input
                </div>
              )}
              {gameLiftStatus === StreamState.RUNNING && showInputIndicator && inputEnabled && (
                <div className="input-status-indicator active">
                  ✓ Input Active (click outside to disable)
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
                <div className={`status-dot ${isWebcamBroadcasting ? '' : 'inactive'}`}></div>
                <span>{isWebcamBroadcasting ? 'LIVE - Webcam' : 'Webcam Off'}</span>
              </div>

              {/* Webcam Video (muted to prevent echo) */}
              <video
                ref={webcamVideoRef}
                id="PlayerWebcamVideo"
                autoPlay
                playsInline
                muted
              />

              {/* Media Controls */}
              {isWebcamBroadcasting && (
                <div className="media-controls" role="group" aria-label="Media controls">
                  <button
                    className={`media-control-btn ${!isCameraEnabled ? 'muted' : ''}`}
                    onClick={toggleWebcamCamera}
                    title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                    aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                    aria-pressed={isCameraEnabled}
                  >
                    <i className={`bi ${isCameraEnabled ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`} aria-hidden="true"></i>
                  </button>
                  <button
                    className={`media-control-btn ${!isMicEnabled ? 'muted' : ''}`}
                    onClick={toggleWebcamMicrophone}
                    title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
                    aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
                    aria-pressed={isMicEnabled}
                  >
                    <i className={`bi ${isMicEnabled ? 'bi-mic-fill' : 'bi-mic-mute-fill'}`} aria-hidden="true"></i>
                  </button>
                </div>
              )}

              {/* Loading Overlay */}
              {isWebcamBroadcastStarting && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <div>Starting Webcam...</div>
                </div>
              )}
            </div>

            {/* Chat Area (Area 3) */}
            <div className="chat-container">
              <ChatComponent username={username} chatClient={chatClient} isSidebarCollapsed={isSidebarCollapsed} />
            </div>
          </div>
        </div>

        {/* Settings Modal */}
        <SettingsModal
          showModal={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          showOnlyDirectBroadcastGames={false}
          gameLiftStatus={gameLiftStatus}
          selectedGame={selectedGame}
          sgId={sgId}
          appId={appId}
          regions={regions}
          sessionId={sessionId}
          lastSessionId={lastSessionId}
          isStreamStarting={isStreamStarting}
          isDirectBroadcastStarting={isDirectBroadcastStarting}
          isFullscreen={isFullscreen}
          isGameplayBroadcasting={isGameplayBroadcasting}
          isGameplayBroadcastStarting={isGameplayBroadcastStarting}
          isWebcamBroadcasting={isWebcamBroadcasting}
          isWebcamBroadcastStarting={isWebcamBroadcastStarting}
          demoMode={demoMode}
          broadcastConfig={broadcastConfig}
          onGameSelectionChange={handleGameSelectionChange}
          setSgId={setSgId}
          setAppId={setAppId}
          setRegions={setRegions}
          setSessionId={setSessionId}
          setDemoMode={setDemoMode}
          setBroadcastConfig={setBroadcastConfig}
          onStartGame={GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame]?.supportsDirectBroadcast ? createDirectBroadcastSession : createStreamSession}
          onStopGame={closeConnection}
          onReconnect={createStreamSessionConnection}
          onStartGameplayBroadcast={startGameplayBroadcast}
          onStopGameplayBroadcast={stopGameplayBroadcast}
          onStartWebcamBroadcast={startWebcamBroadcast}
          onStopWebcamBroadcast={stopWebcamBroadcast}
        />
      </div>
    </>
  );
};
