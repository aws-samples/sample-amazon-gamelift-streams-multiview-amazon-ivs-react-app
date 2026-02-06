/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * InteractivePlayTestView Component
 * Unified interface for interactive play testing with role-based features
 * Supports role swap takeover functionality between player and viewer roles
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as gameliftstreamssdk from '../gamelift-streams-websdk/gameliftstreams-1.0.0';
import { StageConnectionState } from 'amazon-ivs-web-broadcast';
import { ApiError, get, post } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AppSyncChatClient } from '../utils/AppSyncChatClient';
import { IVSStageManager } from '../utils/IVSStageManager';
import { ChatComponent } from './ChatComponent';
import { VolumeControl } from './VolumeControl';
import { SettingsModal } from './SettingsModal';
import { generateUsername } from '../utils/usernameGenerator';
import { STREAM_SOURCE, GAMELIFT_STREAMS_CONFIG, ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST, IVS_WHIP_ENDPOINT } from '../utils/constants';
import { getAppSyncConfig, getRuntimeConfig } from '../utils/configService';
import { RemoteStageStream } from '../types/ivs.types';
import { ControlMessage } from '../types/chat.types';
import './PlayTestViews.css';

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

interface InteractivePlayTestViewProps {
  user: any;
  signOut: () => void;
}

export enum StreamState {
  STOPPED = 1,
  LOADING,
  RUNNING,
  ERROR
}

type TakeoverStatus =
  | 'idle'
  | 'requesting'
  | 'pending_approval'
  | 'approved'
  | 'denied'
  | 'cancelled'
  | 'in_progress'
  | 'complete';

interface TakeoverState {
  status: TakeoverStatus;
  requesterUsername: string | null;
  requestTimestamp: number | null;
  sessionId: string | null;
}

interface ParticipantStreamInfo {
  userId: string;
  username: string;
  videoStream: RemoteStageStream | null;
  audioStream: RemoteStageStream | null;
}

export const InteractivePlayTestView: React.FC<InteractivePlayTestViewProps> = ({ user, signOut }) => {
  const navigate = useNavigate();

  // Role and Control State
  const [userRole, setUserRole] = useState<'player' | 'viewer'>('viewer');
  const [currentController, setCurrentController] = useState<string | null>(null);
  const [hasGameplayControl, setHasGameplayControl] = useState(false);

  // GameLift State (only active when user has control)
  const [gameLiftStatus, setGameLiftStatus] = useState<StreamState>(StreamState.STOPPED);
  const [sessionId, setSessionId] = useState('');
  const [lastSessionId, setLastSessionId] = useState('');
  const [inputEnabled, setInputEnabled] = useState(false);
  const [isStreamStarting, setIsStreamStarting] = useState(false);

  // IVS Stage State
  const [participantStreams, setParticipantStreams] = useState<Map<string, ParticipantStreamInfo>>(new Map());
  const [gameplayStream, setGameplayStream] = useState<RemoteStageStream | null>(null);
  const [gameplayAudioStream, setGameplayAudioStream] = useState<RemoteStageStream | null>(null);
  const [webcamStream, setWebcamStream] = useState<RemoteStageStream | null>(null);
  const [isWebcamBroadcasting, setIsWebcamBroadcasting] = useState(false);
  const [localWebcamStream, setLocalWebcamStream] = useState<MediaStream | null>(null);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isSubscribeOnlyMode, setIsSubscribeOnlyMode] = useState(false);
  const [canRetryPublish, setCanRetryPublish] = useState(false);

  // Game Selection and Configuration State
  const [selectedGame, setSelectedGame] = useState(() => {
    // Find first game that supports direct broadcast, or fallback to first game
    const directBroadcastGames = Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary).filter(
      gameName => GAMELIFT_STREAMS_CONFIG.gameLibrary[gameName]?.supportsDirectBroadcast
    );
    return directBroadcastGames.length > 0 ? directBroadcastGames[0] : Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary)[0] || '';
  });
  const [sgId, setSgId] = useState(() => {
    const directBroadcastGames = Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary).filter(
      gameName => GAMELIFT_STREAMS_CONFIG.gameLibrary[gameName]?.supportsDirectBroadcast
    );
    const firstGame = directBroadcastGames.length > 0 ? directBroadcastGames[0] : Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary)[0];
    const gameConfig = firstGame ? GAMELIFT_STREAMS_CONFIG.gameLibrary[firstGame] : null;
    return gameConfig?.streamGroupId || '';
  });
  const [appId, setAppId] = useState(() => {
    const directBroadcastGames = Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary).filter(
      gameName => GAMELIFT_STREAMS_CONFIG.gameLibrary[gameName]?.supportsDirectBroadcast
    );
    const firstGame = directBroadcastGames.length > 0 ? directBroadcastGames[0] : Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary)[0];
    const gameConfig = firstGame ? GAMELIFT_STREAMS_CONFIG.gameLibrary[firstGame] : null;
    return gameConfig?.applicationId || '';
  });
  const [regions, setRegions] = useState<string[]>([GAMELIFT_STREAMS_CONFIG.defaultRegion]);
  const [demoMode, setDemoMode] = useState(false);
  const [isDirectBroadcastStarting, setIsDirectBroadcastStarting] = useState(false);

  // Broadcast Configuration State
  const [broadcastConfig, setBroadcastConfig] = useState({
    encoderType: 'gpu',
    videoWidth: 1280,
    videoHeight: 720,
    videoFramerate: 30,
    videoBitrate: 6000,
    enableAudio: true,
    audioBitrate: 128000,
    debugPipeline: false,
    debugLevel: 0
  });

  // Settings Modal State
  const [activeTab, setActiveTab] = useState<'general' | 'broadcast'>('general');

  // Takeover State
  const [takeoverState, setTakeoverState] = useState<TakeoverState>({
    status: 'idle',
    requesterUsername: null,
    requestTimestamp: null,
    sessionId: null,
  });

  // UI State
  const [username] = useState(generateUsername());
  const [errors, setErrors] = useState<string[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [showSettingsModal, setShowSettingsModal] = useState(true);
  const [liveRegionMessage, setLiveRegionMessage] = useState<string>('');
  const [hasConnectedToStage, setHasConnectedToStage] = useState(false);
  const [showInputIndicator, setShowInputIndicator] = useState(true);
  const [ivsGameplayVideoElement, setIvsGameplayVideoElement] = useState<HTMLVideoElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isNavCollapsed, setIsNavCollapsed] = useState(true);

  // Refs
  const gameLiftVideoRef = useRef<HTMLVideoElement>(null);
  const gameLiftAudioRef = useRef<HTMLAudioElement>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const ivsGameplayVideoRef = useRef<HTMLVideoElement>(null);
  const participantVideoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const gameliftstreamsRef = useRef<gameliftstreamssdk.GameLiftStreams | null>(null);
  const webcamStageManagerRef = useRef<IVSStageManager>(new IVSStageManager());
  const participantStageManagerRef = useRef<IVSStageManager>(new IVSStageManager());
  const takeoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isProcessingTakeoverApprovalRef = useRef<boolean>(false);
  const capacityErrorHandlerRef = useRef<((error: Error) => void) | null>(null);
  const isSubscribeOnlyModeRef = useRef<boolean>(false);
  const networkHandlersRef = useRef<{
    handleOnline: (() => void) | null;
    handleOffline: (() => void) | null;
  }>({ handleOnline: null, handleOffline: null });
  
  // Accessibility refs for focus management
  const takeoverModalRef = useRef<HTMLDivElement>(null);
  const settingsModalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const liveRegionRef = useRef<HTMLDivElement>(null);

  // Chat Client
  const [chatClient] = useState(() => new AppSyncChatClient(getAppSyncConfig()));

  // Track unread messages when chat is closed
  useEffect(() => {
    const handleNewMessage = () => {
      if (!isChatOpen) {
        setUnreadMessageCount(prev => prev + 1);
      }
    };

    chatClient.onMessage(handleNewMessage);

    return () => {
      // Cleanup is handled by chatClient disconnect in main useEffect
    };
  }, [chatClient, isChatOpen]);

  // Keyboard navigation for modals
  // Implements task 28: Ensure keyboard navigation works
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Handle Escape key for modals
      if (event.key === 'Escape') {
        if (takeoverState.status === 'pending_approval' && hasGameplayControl) {
          // Close takeover notification modal
          dismissTakeover();
        } else if (showSettingsModal) {
          // Close settings modal
          closeSettingsModal();
        } else if (isChatOpen) {
          // Close chat panel
          toggleChat();
        }
      }
    };

    // Add event listener
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [takeoverState.status, hasGameplayControl, showSettingsModal, isChatOpen]);

  // Reset unread count when chat is opened
  useEffect(() => {
    if (isChatOpen) {
      setUnreadMessageCount(0);
    }
  }, [isChatOpen]);

  // Register control message handler with latest state
  // Re-register when hasGameplayControl, userRole, or takeoverState changes to avoid stale closures
  useEffect(() => {
    console.log('Registering control message handler with state:', { hasGameplayControl, userRole, gameLiftStatus, takeoverStatus: takeoverState.status });
    chatClient.onControlMessage(handleControlMessage);
    
    // No cleanup needed - onControlMessage replaces the previous handler
  }, [hasGameplayControl, userRole, gameLiftStatus, takeoverState.status, chatClient]);

  // Handle automatic input attach/detach based on click location
  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      // Only handle if GameLift stream is running and user has control
      if (gameLiftStatus !== StreamState.RUNNING || !hasGameplayControl) {
        return;
      }

      const gameplayContainer = document.getElementById('InteractivePlayTestGameplayContainer');
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
  }, [gameLiftStatus, hasGameplayControl, inputEnabled]);

  // Auto-hide input indicator after 5 seconds when input state changes
  useEffect(() => {
    setShowInputIndicator(true);
    const timer = setTimeout(() => {
      setShowInputIndicator(false);
    }, 5000);

    return () => clearTimeout(timer);
  }, [inputEnabled]);

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

  // Determine user role based on email
  const determineUserRole = (): 'player' | 'viewer' => {
    const email = user.signInDetails?.loginId || user.email;
    console.log('determineUserRole - email:', email);
    const role = email === 'player@ivs.rocks' ? 'player' : 'viewer';
    console.log('determineUserRole - result:', role);
    return role;
  };

  // Monitor network connectivity
  // Implements requirement 16.5: Handle network connectivity loss
  useEffect(() => {
    const handleOnline = () => {
      console.log('Network connection restored');
      setErrors(prev => prev.filter(e => !e.includes('Connection lost') && !e.includes('Network error')));
      setErrors(prev => [...prev, 'Connection restored. Reconnecting...']);
      
      // Attempt to reconnect chat client
      if (!chatClient.isConnectionOpen()) {
        chatClient.connect()
          .then(() => chatClient.subscribe())
          .catch(error => {
            console.error('Failed to reconnect chat:', error);
          });
      }
      
      // Clear the "Connection restored" message after a few seconds
      // Store timeout for cleanup
      const timeoutId = setTimeout(() => {
        setErrors(prev => prev.filter(e => !e.includes('Connection restored')));
      }, 3000);
      
      // Store timeout in ref for potential cleanup
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
      statusTimeoutRef.current = timeoutId;
    };

    const handleOffline = () => {
      console.log('Network connection lost');
      setErrors(prev => [...prev, 'Connection lost. Please check your internet connection.']);
    };

    // Store handlers in ref for cleanup
    networkHandlersRef.current.handleOnline = handleOnline;
    networkHandlersRef.current.handleOffline = handleOffline;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      // Capture ref values for cleanup to avoid React warning
      const handlers = networkHandlersRef.current;
      
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      handlers.handleOnline = null;
      handlers.handleOffline = null;
    };
  }, [chatClient]);

  // Initialize on component mount
  useEffect(() => {
    // Set user role
    const role = determineUserRole();
    setUserRole(role);
    console.log('User role determined:', role);

    // Initialize GameLift Streams SDK after a brief delay to ensure DOM is ready
    const initTimer = setTimeout(() => {
      if (gameLiftVideoRef.current && !gameliftstreamsRef.current) {
        resetGameLiftStreamsSDK();
      }
    }, 100);

    // Load last session ID from localStorage
    const savedSessionId = localStorage.getItem('lastGameLiftSessionId');
    const savedTimestamp = localStorage.getItem('lastGameLiftSessionTimestamp');
    
    if (savedSessionId && savedTimestamp) {
      const timestamp = parseInt(savedTimestamp, 10);
      const now = Date.now();
      const expirationTime = 120 * 1000; // 120 seconds
      
      if (now - timestamp < expirationTime) {
        setLastSessionId(savedSessionId);
        console.log('Loaded last session ID from localStorage:', savedSessionId);
      } else {
        localStorage.removeItem('lastGameLiftSessionId');
        localStorage.removeItem('lastGameLiftSessionTimestamp');
      }
    }

    // Connect to IVS stage for participant webcam/mic
    // Note: This will request camera/mic permissions
    connectToStage();

    // Cleanup on unmount
    return () => {
      console.log('InteractivePlayTestView unmounting - cleaning up resources');
      
      // Clear init timer
      clearTimeout(initTimer);
      
      // Clear all timeout timers
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }
      
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
        statusTimeoutRef.current = null;
      }

      // Properly disconnect GameLift
      if (gameliftstreamsRef.current) {
        try {
          gameliftstreamsRef.current.close();
          gameliftstreamsRef.current = null;
        } catch (error) {
          console.error('Error closing GameLift connection:', error);
        }
      }
      
      // Cleanup stage managers and stop IVS broadcasts
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const webcamManager = webcamStageManagerRef.current;
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const participantManager = participantStageManagerRef.current;
      
      if (webcamManager.isActive()) {
        try {
          webcamManager.leaveStage();
        } catch (error) {
          console.error('Error leaving webcam stage:', error);
        }
      }
      if (participantManager.isActive()) {
        try {
          participantManager.leaveStage();
        } catch (error) {
          console.error('Error leaving participant stage:', error);
        }
      }
      
      // Stop local media streams
      if (localWebcamStream) {
        localWebcamStream.getTracks().forEach(track => {
          track.stop();
        });
      }
      
      // Clean up video element references
      // Capture ref value for cleanup to avoid React warning
      const videoRefs = participantVideoRefs.current;
      videoRefs.clear();
      
      // Disconnect chat client
      try {
        chatClient.disconnect();
      } catch (error) {
        console.error('Error disconnecting chat client:', error);
      }
      
      console.log('InteractivePlayTestView cleanup complete');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetGameLiftStreamsSDK = () => {
    // Only initialize if video element exists
    const videoElement = gameLiftVideoRef.current || document.getElementById('InteractivePlayTestGameLiftVideo') as HTMLVideoElement;
    const audioElement = gameLiftAudioRef.current || document.getElementById('InteractivePlayTestGameLiftAudio') as HTMLAudioElement;
    
    if (!videoElement) {
      console.warn('Video element not ready for GameLift SDK initialization');
      return;
    }
    
    gameliftstreamsRef.current = new gameliftstreamssdk.GameLiftStreams({
      videoElement,
      audioElement,
      inputConfiguration: {
        setCursor: 'visibility',
        autoPointerLock: 'fullscreen'
      },
      clientConnection: {
        applicationMessage: applicationMessageCallback,
      }
    });
  };

  const applicationMessageCallback = (applicationMsg: any) => {
    const decoder = new TextDecoder();
    const msg = decoder.decode(applicationMsg);
    console.log('Application message received:', msg);
    sendAppSyncConfigToGame();
  };

  const sendAppSyncConfigToGame = () => {
    try {
      const appSyncConfig = getAppSyncConfig();
      const config = {
        type: 'AWS_APPSYNC_CONFIG',
        message: {
          appSyncApiKey: appSyncConfig.apiKey,
          appSyncHttpApiEndpoint: appSyncConfig.httpEndpoint.replace('https://', ''),
          appSyncRealtimeEndpoint: appSyncConfig.realtimeEndpoint,
          channelName: appSyncConfig.channelName
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

  /**
   * Handle game selection change
   * Updates application ID and stream group ID based on selected game
   */
  const handleGameSelectionChange = (gameName: string) => {
    setSelectedGame(gameName);
    const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[gameName];
    if (gameConfig) {
      setAppId(gameConfig.applicationId);
      setSgId(gameConfig.streamGroupId);
    }
  };

  /**
   * Check if any games support direct broadcast
   */
  const getDirectBroadcastGames = () => {
    return Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary).filter(
      gameName => GAMELIFT_STREAMS_CONFIG.gameLibrary[gameName]?.supportsDirectBroadcast
    );
  };

  /**
   * Check if direct broadcast is available
   */
  const isDirectBroadcastAvailable = () => {
    return ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST && getDirectBroadcastGames().length > 0;
  };

  /**
   * Start GameLift gameplay session (player role only)
   * Implements task 10: GameLift session start
   * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 11.1, 11.3
   */
  const startGameplaySession = async () => {
    if (userRole !== 'player') {
      console.error('Only player role can start gameplay sessions');
      return;
    }

    if (!isDirectBroadcastAvailable()) {
      setErrors(prev => [...prev, 'No direct broadcast games available. Please configure games with direct broadcast support.']);
      return;
    }

    setIsStreamStarting(true);
    setErrors([]);

    try {
      // Ensure GameLift SDK is initialized
      if (!gameliftstreamsRef.current) {
        console.log('GameLift SDK not initialized, initializing now...');
        resetGameLiftStreamsSDK();
        // Wait a bit for initialization
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      if (!gameliftstreamsRef.current) {
        throw new Error('Failed to initialize GameLift Streams SDK');
      }

      // For direct broadcast games, generate IVS stage token for GameLift instance
      let gameLiftPublishToken: string | null = null;
      console.log('Checking if game supports direct broadcast:', {
        selectedGame,
        supportsDirectBroadcast: GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame]?.supportsDirectBroadcast
      });
      
      if (GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame]?.supportsDirectBroadcast) {
        console.log('Generating IVS publish token for GameLift instance...');
        try {
          const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame];
          gameLiftPublishToken = await participantStageManagerRef.current.fetchParticipantToken(
            `${username}-gamelift`,
            ['PUBLISH'],
            'gameplay',
            gameConfig?.supportsCouchCoop
          );
          console.log('Successfully generated IVS publish token for GameLift instance:', gameLiftPublishToken ? 'Token received' : 'Token is null');
        } catch (tokenError) {
          console.error('GameLift publish token generation failed:', tokenError);
          const errorMsg = 'Failed to generate IVS credentials for GameLift instance. Please try again.';
          setErrors(prev => [...prev, errorMsg]);
          setIsStreamStarting(false);
          return;
        }
      } else {
        console.log('Game does not support direct broadcast, skipping token generation');
      }

      // Generate signal request from GameLift Streams SDK
      const signalRequest = await gameliftstreamsRef.current.generateSignalRequest();
      
      // Create payload with IVS credentials as environment variables for direct broadcast
      const shouldIncludeEnvVars = GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame]?.supportsDirectBroadcast && gameLiftPublishToken;
      console.log('Should include environment variables:', {
        supportsDirectBroadcast: GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame]?.supportsDirectBroadcast,
        hasToken: !!gameLiftPublishToken,
        shouldInclude: shouldIncludeEnvVars
      });
      
      const payload = {
        AppIdentifier: appId,
        SGIdentifier: sgId,
        SignalRequest: signalRequest ?? '',
        Regions: regions,
        // Include IVS environment variables for direct broadcast games
        ...(shouldIncludeEnvVars && {
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
            DEBUG_PIPELINE: broadcastConfig.debugPipeline.toString(),
            GST_DEBUG: broadcastConfig.debugLevel.toString()
          }
        })
      };

      console.log('Creating GameLift stream session with IVS environment variables...');
      console.log('Payload being sent:', JSON.stringify(payload, null, 2));

      // Create stream session via API
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
      
      console.log('Stream session created, waiting for ACTIVE status...');
      
      // Wait for session to become ACTIVE and start stream
      await waitForACTIVE(data.arn, sgId);
    } catch (error) {
      console.error('Failed to start gameplay session:', error);
      handleGameLiftError(error);
    }
  };

  /**
   * Wait for GameLift session to become ACTIVE
   */
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
          console.log('Session is ACTIVE, starting stream...');
          await startGameLiftStream(data.signalResponse);
          
          // Store session ID
          setSessionId(arn);
          setLastSessionId(arn);
          localStorage.setItem('lastGameLiftSessionId', arn);
          localStorage.setItem('lastGameLiftSessionTimestamp', Date.now().toString());
          
          return;
        }
        
        // Wait 1 second before polling again
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error('Error polling session status:', error);
        handleGameLiftError(error);
        setIsStreamStarting(false);
        return;
      }
    }
    
    // Timeout
    const message = 'Stream session creation timed out. This can happen when no compute resources are available. Please try again in a few moments.';
    console.error('Polling timed out:', message);
    setErrors(prev => [...prev, message]);
    setIsStreamStarting(false);
  };

  /**
   * Start GameLift stream with signal response
   * Auto-starts IVS broadcast after connection
   */
  const startGameLiftStream = async (signalResponse: any) => {
    console.log('Starting GameLift stream');
    
    try {
      // Process signal response to establish WebRTC connection
      await gameliftstreamsRef.current?.processSignalResponse(signalResponse);
      
      // Update state
      console.log('Setting hasGameplayControl to TRUE for username:', username);
      setGameLiftStatus(StreamState.RUNNING);
      setHasGameplayControl(true);
      setCurrentController(username);
      setIsStreamStarting(false);
      setInputEnabled(false);
      
      console.log('GameLift stream started successfully - hasGameplayControl should now be true');
      
      // For direct broadcast games, the broadcast happens on the GameLift server
      // No need to start IVS broadcast from the browser
    } catch (error) {
      console.error('Failed to start GameLift stream:', error);
      handleGameLiftError(error);
    }
  };



  /**
   * Handle GameLift errors with user-friendly messages
   * Implements requirement 16.1: GameLift connection failure handling
   */
  const handleGameLiftError = (e: any, context: 'start' | 'reconnect' | 'general' = 'general') => {
    console.error('GameLift error:', e);
    setIsStreamStarting(false);
    setGameLiftStatus(StreamState.ERROR);
    
    let errorMessage = 'An error occurred with the GameLift stream.';
    let canRetry = true;
    
    if (e instanceof ApiError) {
      if (e.response) {
        const { statusCode, body } = e.response;
        console.error(`Received ${statusCode} error response with payload: ${body}`);
        
        try {
          const data = JSON.parse(body ?? '{}');
          
          // Provide user-friendly error messages based on status code
          // Requirement 16.1: Failed to connect to gameplay session with retry option
          if (statusCode === 400) {
            errorMessage = 'Invalid stream configuration. Please check your Stream Group ID and Application ID.';
            canRetry = false;
          } else if (statusCode === 401 || statusCode === 403) {
            errorMessage = 'Authentication failed. Please sign out and sign in again.';
            canRetry = false;
          } else if (statusCode === 404) {
            if (context === 'reconnect') {
              // Requirement 16.4: Invalid or expired session ID
              errorMessage = 'Session no longer available. The gameplay session may have expired.';
              canRetry = false;
            } else {
              errorMessage = 'Stream Group or Application not found. Please verify your configuration.';
              canRetry = false;
            }
          } else if (statusCode === 410) {
            // Requirement 16.4: Session expired
            errorMessage = 'Session no longer available. The gameplay session has expired.';
            canRetry = false;
          } else if (statusCode === 429) {
            errorMessage = 'Too many requests. Please wait a moment before trying again.';
            canRetry = true;
          } else if (statusCode === 503) {
            errorMessage = 'GameLift service is temporarily unavailable. Please try again in a few moments.';
            canRetry = true;
          } else if (statusCode >= 500) {
            errorMessage = 'GameLift server error. Please try again later.';
            canRetry = true;
          } else {
            errorMessage = data.message || `Stream error (${statusCode}). Please try again.`;
            canRetry = true;
          }
        } catch (parseError) {
          errorMessage = `Stream error (${statusCode}). Please try again.`;
          canRetry = true;
        }
      }
    } else if (e instanceof Error) {
      // Handle specific error types
      if (e.message.includes('timeout')) {
        // Requirement 16.5: Network connectivity loss
        errorMessage = 'Stream connection timed out. Please check your connection and try again.';
        canRetry = true;
      } else if (e.message.includes('network') || e.message.includes('fetch') || e.message.includes('Failed to fetch')) {
        // Requirement 16.5: Network connectivity loss
        errorMessage = 'Network error. Please check your internet connection and try again.';
        canRetry = true;
      } else if (e.message.includes('session')) {
        if (e.message.includes('expired') || e.message.includes('invalid')) {
          // Requirement 16.4: Invalid/expired session ID
          errorMessage = 'Session no longer available. The gameplay session may have expired.';
          canRetry = false;
        } else {
          errorMessage = 'Failed to create stream session. Please try again.';
          canRetry = true;
        }
      } else {
        errorMessage = `Stream error: ${e.message}`;
        canRetry = true;
      }
    }
    
    // Add retry option if applicable (Requirement 16.1)
    const fullMessage = canRetry 
      ? `${errorMessage} Click "Start Gameplay Session" or "Request Takeover" to retry.`
      : errorMessage;
    
    setErrors(prev => [...prev, fullMessage]);
  };

  /**
   * Handle IVS broadcast errors with user-friendly messages
   * Implements requirement 16.2: IVS broadcast failure handling with retry
   */
  const handleIVSBroadcastError = (e: any, streamType: 'gameplay' | 'webcam' = 'gameplay') => {
    console.error(`IVS ${streamType} broadcast error:`, e);
    
    let errorMessage = `Failed to start ${streamType} broadcast.`;
    
    if (e instanceof Error) {
      if (e.message.includes('permission') || e.message.includes('denied')) {
        errorMessage = `Camera/microphone access denied. Cannot broadcast ${streamType}.`;
      } else if (e.message.includes('network') || e.message.includes('timeout')) {
        // Requirement 16.5: Network connectivity loss
        errorMessage = `Network error while starting ${streamType} broadcast. Please check your connection.`;
      } else if (e.message.includes('token')) {
        errorMessage = `Failed to get broadcast token for ${streamType}. Please try again.`;
      } else if (e.message.includes('captureStream')) {
        errorMessage = `Your browser doesn't support ${streamType} capture. Please try a different browser.`;
      } else {
        errorMessage = `${errorMessage} ${e.message}`;
      }
    }
    
    // Requirement 16.2: Provide retry option
    if (streamType === 'gameplay') {
      errorMessage += ' Gameplay is active but not visible to others. You can retry broadcasting manually.';
    }
    
    setErrors(prev => [...prev, errorMessage]);
  };

  /**
   * Handle control message send errors
   * Implements requirement 16.3: Control message send failure handling
   */
  const handleControlMessageError = (e: any, messageType: string) => {
    console.error(`Failed to send ${messageType} control message:`, e);
    
    let errorMessage = `Failed to send ${messageType}.`;
    
    if (e instanceof Error) {
      if (e.message.includes('Not connected') || e.message.includes('not subscribed')) {
        // Requirement 16.5: Network connectivity loss
        errorMessage = 'Connection lost. Attempting to reconnect...';
      } else if (e.message.includes('timeout')) {
        errorMessage = `${messageType} timed out. Please try again.`;
      } else if (e.message.includes('network')) {
        // Requirement 16.5: Network connectivity loss
        errorMessage = 'Network error. Please check your connection and try again.';
      }
    }
    
    // Requirement 16.3: Re-enable request button on failure
    setErrors(prev => [...prev, errorMessage]);
  };



  /**
   * Request takeover of gameplay control (anyone without control can request)
   * Implements task 12: Takeover request
   * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 13.1
   */
  const requestTakeover = async () => {
    // Only allow takeover requests if user doesn't have control
    if (hasGameplayControl) {
      console.error('Cannot request takeover - you already have control');
      return;
    }

    // Check if there's an active gameplay session (either via currentController or gameplayStream)
    if (!currentController && !gameplayStream) {
      console.error('No active gameplay session to take over');
      return;
    }

    if (takeoverState.status === 'requesting') {
      console.log('Takeover request already in progress');
      return;
    }

    try {
      console.log('Sending takeover request...');

      // Clear any existing timeout (cleanup on state transition)
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }

      // Set takeover state to 'requesting'
      setTakeoverState({
        status: 'requesting',
        requesterUsername: username,
        requestTimestamp: Date.now(),
        sessionId: null,
      });

      // Send TAKEOVER_REQUEST control message
      await chatClient.publishControlMessage('TAKEOVER_REQUEST', {
        requesterUsername: username,
      });

      console.log('Takeover request sent successfully');

      // Set 60-second timeout
      takeoverTimeoutRef.current = setTimeout(() => {
        // Check if still in requesting state
        setTakeoverState(prev => {
          if (prev.status === 'requesting') {
            console.log('Takeover request timed out');
            return {
              status: 'cancelled',
              requesterUsername: null,
              requestTimestamp: null,
              sessionId: null,
            };
          }
          return prev;
        });

        // Clear timeout state after showing message briefly
        // Store this timeout for cleanup
        const statusTimeout = setTimeout(() => {
          setTakeoverState(prev => {
            if (prev.status === 'cancelled') {
              return {
                status: 'idle',
                requesterUsername: null,
                requestTimestamp: null,
                sessionId: null,
              };
            }
            return prev;
          });
        }, 3000);
        
        // Store status timeout for cleanup
        if (statusTimeoutRef.current) {
          clearTimeout(statusTimeoutRef.current);
        }
        statusTimeoutRef.current = statusTimeout;

        takeoverTimeoutRef.current = null;
      }, 60000); // 60 seconds

      console.log('Takeover request timeout set for 60 seconds');

    } catch (error) {
      console.error('Failed to send takeover request:', error);
      // Requirement 16.3: Handle control message send failures
      handleControlMessageError(error, 'takeover request');
      
      // Clear timeout on error (cleanup on state transition)
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }
      
      // Requirement 16.3: Re-enable request button on failure
      // Reset takeover state on error
      setTakeoverState({
        status: 'idle',
        requesterUsername: null,
        requestTimestamp: null,
        sessionId: null,
      });
    }
  };

  /**
   * Approve takeover request
   * Implements task 14: Takeover approval logic
   * Requirements: 7.3, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5
   */
  const approveTakeover = async () => {
    if (takeoverState.status !== 'pending_approval') {
      console.log('No pending takeover request to approve');
      return;
    }

    if (!hasGameplayControl) {
      console.error('Cannot approve takeover - not the current controller');
      return;
    }

    try {
      console.log('Approving takeover request');

      // Clear timeout (cleanup on state transition)
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }

      // Extract current session ID (Requirement 8.4)
      const currentSessionId = sessionId || lastSessionId;
      if (!currentSessionId) {
        console.error('No session ID available to transfer');
        setErrors(prev => [...prev, 'Cannot approve takeover - no active session']);
        return;
      }

      // For direct broadcast games, broadcast stops automatically when GameLift session ends

      // Properly disconnect GameLift on takeover (Requirement 8.1)
      if (gameliftstreamsRef.current) {
        console.log('Closing GameLift Streams connection');
        try {
          gameliftstreamsRef.current.close();
          gameliftstreamsRef.current = null;
        } catch (error) {
          console.error('Error closing GameLift connection:', error);
        }
      }
      // Wait a moment to ensure the message is delivered before disconnecting
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('Transferring session ID:', currentSessionId);

      // Send TAKEOVER_APPROVED control message with session ID and requester username (Requirement 8.4)
      // This ensures the requester receives the message before we disconnect
      console.log('Sending TAKEOVER_APPROVED message with session ID to:', takeoverState.requesterUsername);
      await chatClient.publishControlMessage('TAKEOVER_APPROVED', {
        sessionId: currentSessionId,
        requesterUsername: takeoverState.requesterUsername,
      });

      // Update state to reflect loss of control (Requirement 8.5)
      setGameLiftStatus(StreamState.STOPPED);
      setHasGameplayControl(false);
      setCurrentController(null);
      setInputEnabled(false);

      // Announce to screen readers
      announceToScreenReader('Takeover approved. Control transferred.');

      // Restore focus before closing modal
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }

      // Clear takeover state
      setTakeoverState({
        status: 'idle',
        requesterUsername: null,
        requestTimestamp: null,
        sessionId: null,
      });

      // Reset GameLift SDK for potential future use
      resetGameLiftStreamsSDK();

      console.log('Takeover approved successfully - transitioned to viewer mode');
    } catch (error) {
      console.error('Failed to approve takeover:', error);
      // Requirement 16.3: Handle control message send failures
      handleControlMessageError(error, 'takeover approval');
      
      // Clear timeout on error (cleanup on state transition)
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }
      
      // Restore focus on error
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
      
      // Reset takeover state on error
      setTakeoverState({
        status: 'idle',
        requesterUsername: null,
        requestTimestamp: null,
        sessionId: null,
      });
    }
  };

  /**
   * Deny takeover request
   * Implements task 15: Takeover denial logic
   * Requirements: 7.4
   */
  const denyTakeover = async () => {
    if (takeoverState.status !== 'pending_approval') {
      console.log('No pending takeover request to deny');
      return;
    }

    try {
      console.log('Denying takeover request');

      // Clear timeout (cleanup on state transition)
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }

      // Send TAKEOVER_DENIED control message
      await chatClient.publishControlMessage('TAKEOVER_DENIED', {});

      // Announce to screen readers
      announceToScreenReader('Takeover request denied.');

      // Restore focus before closing modal
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }

      // Clear takeover state
      setTakeoverState({
        status: 'idle',
        requesterUsername: null,
        requestTimestamp: null,
        sessionId: null,
      });

      console.log('Takeover request denied successfully');
    } catch (error) {
      console.error('Failed to deny takeover request:', error);
      // Requirement 16.3: Handle control message send failures
      handleControlMessageError(error, 'takeover denial');
      
      // Clear timeout on error (cleanup on state transition)
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }
      
      // Restore focus on error
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    }
  };

  /**
   * Dismiss takeover request without responding
   * Implements task 16: Takeover dismissal logic
   * Requirements: 17.2, 17.3
   */
  const dismissTakeover = async () => {
    if (takeoverState.status !== 'pending_approval') {
      console.log('No pending takeover request to dismiss');
      return;
    }

    try {
      console.log('Dismissing takeover request');

      // Clear timeout (cleanup on state transition)
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }

      // Send TAKEOVER_CANCELLED control message
      await chatClient.publishControlMessage('TAKEOVER_CANCELLED', {});

      // Announce to screen readers
      announceToScreenReader('Takeover request dismissed.');

      // Restore focus before closing modal
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }

      // Hide notification and clear takeover state
      setTakeoverState({
        status: 'idle',
        requesterUsername: null,
        requestTimestamp: null,
        sessionId: null,
      });

      console.log('Takeover request dismissed successfully');
    } catch (error) {
      console.error('Failed to dismiss takeover request:', error);
      // Requirement 16.3: Handle control message send failures
      handleControlMessageError(error, 'takeover dismissal');
      
      // Clear timeout on error (cleanup on state transition)
      if (takeoverTimeoutRef.current) {
        clearTimeout(takeoverTimeoutRef.current);
        takeoverTimeoutRef.current = null;
      }
      
      // Restore focus on error
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    }
  };

  /**
   * Handle stage capacity error by switching to subscribe-only mode
   */
  const handleStageCapacityError = async (localStream: MediaStream | null) => {
    console.warn('Handling stage capacity error, switching to subscribe-only mode');
    
    try {
      // Stop local media tracks since we won't be publishing
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      setLocalWebcamStream(null);
      
      // Remove local video element
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = null;
      }
      
      // Cancel any automatic reconnection attempts
      participantStageManagerRef.current.cancelReconnect();
      
      // Leave the current stage
      await participantStageManagerRef.current.leaveStage();
      
      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get subscribe-only token
      const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame];
      const subscribeOnlyToken = await participantStageManagerRef.current.fetchParticipantToken(
        username,
        ['SUBSCRIBE'],
        'participant_webcam',
        gameConfig?.supportsCouchCoop
      );
      
      // Create stage without local streams
      await participantStageManagerRef.current.createStage({
        participantToken: subscribeOnlyToken,
        streams: [],
        onConnectionStateChange: (state: StageConnectionState) => {
          console.log('Participant stage connection state:', state);
          if (state === StageConnectionState.CONNECTED) {
            setErrors(prev => prev.filter(e => !e.includes('Connection lost')));
          } else if (state === StageConnectionState.DISCONNECTED) {
            setErrors(prev => [...prev, 'Connection lost. Attempting to reconnect...']);
          }
        },
        onStreamsAdded: handleStreamsAdded,
        onParticipantLeft: handleParticipantLeft,
        onError: (error: Error) => {
          console.error('Participant stage error:', error);
          handleIVSBroadcastError(error, 'webcam');
        }
      });
      
      // Join in subscribe-only mode
      await participantStageManagerRef.current.joinStage();
      
      // Update state
      setIsSubscribeOnlyMode(true);
      isSubscribeOnlyModeRef.current = true;
      setIsWebcamBroadcasting(false);
      
      // Add error message
      const message = 'Stage is at capacity (12 participants max). You can view but not broadcast. You\'ll be able to enable your camera when someone leaves.';
      setErrors(prev => {
        // Avoid duplicate messages
        if (prev.includes(message)) return prev;
        return [...prev, message];
      });
      
      console.log('Successfully joined stage in subscribe-only mode due to capacity');
    } catch (error) {
      console.error('Failed to switch to subscribe-only mode:', error);
      setErrors(prev => [...prev, 'Failed to connect to stage. Please refresh the page.']);
    }
  };

  /**
   * Connect to IVS stage for all participants
   * Implements task 5: IVS stage connection for all participants
   * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
   */
  const connectToStage = async () => {
    try {
      console.log('Connecting to IVS stage as participant...');

      // Request participant token with PUBLISH+SUBSCRIBE capabilities
      const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame];
      const participantToken = await participantStageManagerRef.current.fetchParticipantToken(
        username,
        ['PUBLISH', 'SUBSCRIBE'],
        'participant_webcam',
        gameConfig?.supportsCouchCoop
      );

      console.log('Participant token received');

      // Request webcam and microphone permissions
      let localMediaStream: MediaStream | null = null;
      try {
        localMediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        console.log('Media permissions granted');
      } catch (mediaError) {
        console.warn('Media permissions denied, falling back to subscribe-only mode:', mediaError);
        // Requirement 2.5: Handle permission denial gracefully
        setErrors(prev => [...prev, 'Camera and microphone access denied. You can still view the session but won\'t be able to provide video/audio feedback.']);
        
        // Fall back to subscribe-only mode
        const subscribeOnlyToken = await participantStageManagerRef.current.fetchParticipantToken(
          username,
          ['SUBSCRIBE'],
          'participant_webcam',
          gameConfig?.supportsCouchCoop
        );

        // Create stage without local streams
        await participantStageManagerRef.current.createStage({
          participantToken: subscribeOnlyToken,
          streams: [],
          onConnectionStateChange: (state: StageConnectionState) => {
            console.log('Participant stage connection state:', state);
            // Requirement 16.5: Handle network connectivity loss
            if (state === StageConnectionState.DISCONNECTED) {
              setErrors(prev => [...prev, 'Connection lost. Attempting to reconnect...']);
            } else if (state === StageConnectionState.CONNECTED) {
              // Clear connection lost errors
              setErrors(prev => prev.filter(e => !e.includes('Connection lost')));
            }
          },
          onStreamsAdded: handleStreamsAdded,
          onParticipantLeft: handleParticipantLeft,
          onError: (error: Error) => {
            console.error('Participant stage error:', error);
            // Requirement 16.2: Handle IVS stage errors
            handleIVSBroadcastError(error, 'webcam');
          }
        });

        await participantStageManagerRef.current.joinStage();
        console.log('Successfully joined stage in subscribe-only mode');
        return;
      }

      // Store local webcam stream
      setLocalWebcamStream(localMediaStream);

      // Create LocalStageStream instances from media tracks
      const localStreams = participantStageManagerRef.current.createLocalStreams(localMediaStream);

      // Set up capacity error handler before creating stage
      capacityErrorHandlerRef.current = (error: any) => {
        console.log('=== Capacity error handler called ===');
        console.log('Error code:', error.code);
        console.log('Error category:', error.category);
        console.log('Error message:', error.message);
        
        // Check for STAGE_AT_CAPACITY error code (6) or PUBLISH_ERROR category
        if (error.code === 6 || error.message?.includes('Stage at capacity') || error.category === 'PUBLISH_ERROR') {
          console.log('Stage at capacity error detected, triggering handler');
          // Use setTimeout to break out of the callback context
          setTimeout(() => {
            handleStageCapacityError(localMediaStream);
          }, 0);
        } else {
          console.log('Not a capacity error, calling handleIVSBroadcastError');
          handleIVSBroadcastError(error, 'webcam');
        }
      };

      // Create and join IVS stage with local streams
      await participantStageManagerRef.current.createStage({
        participantToken,
        streams: localStreams,
        onConnectionStateChange: (state: StageConnectionState) => {
          console.log('Participant stage connection state:', state);
          if (state === StageConnectionState.CONNECTED) {
            setIsWebcamBroadcasting(true);
            
            // Attach local stream to video element for preview
            if (webcamVideoRef.current && localMediaStream) {
              webcamVideoRef.current.srcObject = localMediaStream;
            }
            
            // Clear connection lost errors
            setErrors(prev => prev.filter(e => !e.includes('Connection lost')));
          } else if (state === StageConnectionState.DISCONNECTED) {
            setIsWebcamBroadcasting(false);
            // Requirement 16.5: Handle network connectivity loss
            setErrors(prev => [...prev, 'Connection lost. Attempting to reconnect...']);
          }
        },
        onStreamsAdded: handleStreamsAdded,
        onParticipantLeft: handleParticipantLeft,
        onError: (error: Error) => {
          console.log('=== onError callback triggered ===');
          console.error('Participant stage error:', error);
          
          // Call the capacity error handler
          if (capacityErrorHandlerRef.current) {
            capacityErrorHandlerRef.current(error);
          } else {
            console.log('No capacity error handler set!');
          }
        }
      });

      // Join the stage
      await participantStageManagerRef.current.joinStage();
      console.log('Successfully connected to IVS stage as participant');
    } catch (error) {
      console.error('Failed to connect to IVS stage:', error);
      // Requirement 16.2: Handle IVS connection failures
      let errorMessage = 'Failed to connect to stage.';
      
      if (error instanceof Error) {
        if (error.message.includes('token')) {
          errorMessage = 'Failed to get stage token. Please refresh the page and try again.';
        } else if (error.message.includes('network') || error.message.includes('timeout')) {
          // Requirement 16.5: Network connectivity loss
          errorMessage = 'Network error. Please check your internet connection and refresh the page.';
        } else {
          errorMessage = `Failed to connect to stage: ${error.message}`;
        }
      }
      
      setErrors(prev => [...prev, errorMessage]);
    }
  };

  /**
   * Handle streams being added to the IVS stage
   * Implements task 6: Participant stream rendering
   * Requirements: 3.1, 3.2, 3.3, 3.5
   */
  const handleStreamsAdded = (streams: RemoteStageStream[]) => {
    console.log('Streams added:', streams.length);
    
    streams.forEach((stream: any) => {
      const participantInfo = stream._participantInfo;
      const isLocal = stream._isLocal;
      const streamSource = participantInfo?.attributes?.stream_source;
      const mediaStreamTrack = stream.mediaStreamTrack;

      if (!mediaStreamTrack) {
        console.warn('Stream has no mediaStreamTrack');
        return;
      }

      const trackKind = mediaStreamTrack.kind;
      console.log(`Processing ${trackKind} track with source:`, streamSource, 'from participant:', participantInfo?.userId, 'isLocal:', isLocal);

      // Skip local streams - we handle those separately
      if (isLocal) {
        console.log('Skipping local stream');
        return;
      }

      // Handle participant webcam streams (from other participants)
      if (streamSource === 'participant_webcam') {
        const userId = participantInfo?.userId;
        const participantUsername = participantInfo?.attributes?.username || userId;

        console.log(`Adding ${trackKind} track for participant:`, participantUsername);

        setParticipantStreams(prev => {
          const updated = new Map(prev);
          const existing = updated.get(userId) || {
            userId,
            username: participantUsername,
            videoStream: null,
            audioStream: null
          };

          if (trackKind === 'video') {
            existing.videoStream = stream;
          } else if (trackKind === 'audio') {
            existing.audioStream = stream;
          }

          updated.set(userId, existing);
          console.log('Updated participant streams map, size:', updated.size);
          return updated;
        });
      }
      // Handle gameplay streams (from current controller)
      else if (streamSource === 'gameplay') {
        console.log(`Received gameplay ${trackKind} stream`);
        if (trackKind === 'video') {
          setGameplayStream(stream);
        } else if (trackKind === 'audio') {
          setGameplayAudioStream(stream);
        }
      }
      // Handle player webcam streams (from current controller)
      else if (streamSource === 'player_webcam') {
        console.log(`Received player webcam ${trackKind} stream`);
        if (trackKind === 'video') {
          setWebcamStream(stream);
        }
      }
    });
  };

  /**
   * Handle participant leaving the stage
   * Implements task 6: Remove video elements when participants leave
   * Requirement: 3.5
   */
  const handleParticipantLeft = (participantInfo: any) => {
    const userId = participantInfo?.userId;
    const streamSource = participantInfo?.attributes?.stream_source;
    
    console.log('Participant left:', userId, 'stream_source:', streamSource);
    console.log('Current state - isSubscribeOnlyMode:', isSubscribeOnlyMode, 'isSubscribeOnlyModeRef:', isSubscribeOnlyModeRef.current, 'canRetryPublish:', canRetryPublish);

    // Remove participant from the map if they had participant_webcam streams
    if (streamSource === 'participant_webcam' && userId) {
      setParticipantStreams(prev => {
        const updated = new Map(prev);
        updated.delete(userId);
        console.log('Removed participant from map, new size:', updated.size);
        
        // Clean up video element reference
        participantVideoRefs.current.delete(userId);
        
        return updated;
      });
      
      // If we're in subscribe-only mode due to capacity, allow retry
      // Use ref to avoid stale closure
      if (isSubscribeOnlyModeRef.current) {
        console.log('Participant left - enabling retry to join with publish permissions');
        setCanRetryPublish(true);
        
        // Add success message (not error) - use a special prefix to style it differently
        const message = 'SUCCESS: A participant left. You can now enable your camera and microphone.';
        setErrors(prev => {
          // Avoid duplicate messages
          if (prev.includes(message)) return prev;
          return [...prev, message];
        });
      } else {
        console.log('Not in subscribe-only mode, skipping retry enable');
      }
    }
  };

  /**
   * Handle incoming control messages
   * Routes control messages to appropriate handlers
   * Implements task 21: Control message routing
   * Requirements: 12.2, 12.3, 12.5
   */
  const handleControlMessage = (message: ControlMessage) => {
    console.log('Received control message:', message);

    try {
      const action = message.action;
      
      if (action === 'TAKEOVER_REQUEST') {
        handleTakeoverRequest(message);
      } else if (action === 'TAKEOVER_APPROVED') {
        handleTakeoverApproval(message);
      } else if (action === 'TAKEOVER_DENIED') {
        handleTakeoverDenial(message);
      } else if (action === 'TAKEOVER_CANCELLED') {
        handleTakeoverCancellation(message);
      } else {
        console.warn('Unknown control message action:', action);
      }
    } catch (error) {
      console.error('Error handling control message:', error);
      // Don't crash - handle gracefully
    }
  };

  /**
   * Handle incoming takeover request
   * Implements task 13: Takeover notification for current controller
   * Requirements: 7.1, 7.2, 7.3, 7.4, 14.1, 14.4, 17.1, 17.5
   */
  const handleTakeoverRequest = (message: any) => {
    console.log('handleTakeoverRequest called:', { hasGameplayControl, userRole, gameLiftStatus, message });
    
    const requesterUsername = message.requesterUsername;
    if (!requesterUsername) {
      console.error('Takeover request missing requesterUsername');
      return;
    }

    // Ignore our own takeover requests
    if (requesterUsername === username) {
      console.log('Ignoring takeover request - this is our own request');
      return;
    }
    
    // Only process if we're the current controller
    if (!hasGameplayControl) {
      console.log('Ignoring takeover request - not the current controller');
      return;
    }

    // Prevent multiple simultaneous requests (Requirement 14.1, 14.4)
    if (takeoverState.status === 'pending_approval') {
      console.log('Ignoring takeover request - already processing a request');
      return;
    }

    console.log(`Received takeover request from: ${requesterUsername}`);

    // Clear any existing timeout (cleanup on state transition)
    if (takeoverTimeoutRef.current) {
      clearTimeout(takeoverTimeoutRef.current);
      takeoverTimeoutRef.current = null;
    }

    // Store current focus for restoration later
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Set takeover state to pending_approval
    setTakeoverState({
      status: 'pending_approval',
      requesterUsername,
      requestTimestamp: Date.now(),
      sessionId: null,
    });

    // Announce to screen readers
    announceToScreenReader(`Takeover request from ${requesterUsername}. Please approve or deny.`);

    // Focus the modal after a brief delay to allow rendering
    setTimeout(() => {
      if (takeoverModalRef.current) {
        const firstButton = takeoverModalRef.current.querySelector('button');
        if (firstButton) {
          (firstButton as HTMLButtonElement).focus();
        }
      }
    }, 100);

    // Auto-dismiss after 60 seconds (Requirement 17.5)
    takeoverTimeoutRef.current = setTimeout(() => {
      console.log('Takeover request auto-dismissed after 60 seconds');
      
      // Send cancellation message to requester
      chatClient.publishControlMessage('TAKEOVER_CANCELLED', {})
        .catch(error => {
          console.error('Failed to send takeover cancellation:', error);
        });

      // Restore focus before closing modal
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }

      // Reset takeover state
      setTakeoverState({
        status: 'idle',
        requesterUsername: null,
        requestTimestamp: null,
        sessionId: null,
      });

      takeoverTimeoutRef.current = null;
    }, 60000); // 60 seconds

    console.log('Takeover notification displayed with 60-second auto-dismiss');
  };

  /**
   * Handle takeover approval from current controller
   * Implements task 17: Takeover approval handling (requester)
   * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 11.5
   */
  const handleTakeoverApproval = async (message: any) => {
    // Prevent duplicate processing of the same approval message
    if (isProcessingTakeoverApprovalRef.current) {
      console.log('Ignoring takeover approval - already processing an approval');
      return;
    }

    // Only process if this approval is for us
    const requesterUsername = message.requesterUsername;
    if (requesterUsername !== username) {
      console.log('Ignoring takeover approval - not for this user (for:', requesterUsername, 'we are:', username, ')');
      return;
    }

    // Only process if we're the requester and in requesting state
    if (takeoverState.status !== 'requesting') {
      console.log('Ignoring takeover approval - not in requesting state (status:', takeoverState.status, ')');
      return;
    }

    // Set processing flag immediately to prevent duplicate processing
    isProcessingTakeoverApprovalRef.current = true;

    // Extract session ID from message (Requirement 9.1)
    const transferredSessionId = message.sessionId;
    if (!transferredSessionId) {
      console.error('Takeover approval missing session ID');
      setErrors(prev => [...prev, 'Failed to receive session ID for takeover']);
      setTakeoverState({
        status: 'idle',
        requesterUsername: null,
        requestTimestamp: null,
        sessionId: null,
      });
      return;
    }

    console.log('Takeover approved! Received session ID:', transferredSessionId);

    // Immediately update state to 'approved' to prevent duplicate processing
    // This must happen synchronously before any async operations
    setTakeoverState({
      status: 'approved',
      requesterUsername: null,
      requestTimestamp: null,
      sessionId: transferredSessionId,
    });

    // Clear timeout (cleanup on state transition)
    if (takeoverTimeoutRef.current) {
      clearTimeout(takeoverTimeoutRef.current);
      takeoverTimeoutRef.current = null;
    }

    try {
      // Store session ID for connection
      setSessionId(transferredSessionId);
      setLastSessionId(transferredSessionId);
      localStorage.setItem('lastGameLiftSessionId', transferredSessionId);
      localStorage.setItem('lastGameLiftSessionTimestamp', Date.now().toString());

      // Update state to 'in_progress'
      setTakeoverState(prev => ({
        ...prev,
        status: 'in_progress',
      }));

      // Ensure GameLift SDK is fully cleaned up before reconnecting
      if (gameliftstreamsRef.current) {
        try {
          gameliftstreamsRef.current.close();
          gameliftstreamsRef.current = null;
        } catch (error) {
          console.warn('Error closing existing GameLift instance:', error);
        }
      }

      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Initialize GameLift Streams SDK (Requirement 9.2)
      resetGameLiftStreamsSDK();

      // Wait for SDK initialization
      await new Promise(resolve => setTimeout(resolve, 200));

      // Retry logic for GameLift connection
      let retryCount = 0;
      const maxRetries = 3;
      let lastError: any = null;

      while (retryCount < maxRetries) {
        try {
          // Create GameLift connection using session ID (Requirement 9.3)
          console.log(`Connecting to GameLift session (attempt ${retryCount + 1}/${maxRetries})...`);
          setIsStreamStarting(true);

          const signalRequest = await gameliftstreamsRef.current?.generateSignalRequest();
          const payload = {
            SessionIdentifier: transferredSessionId,
            SignalRequest: signalRequest ?? '',
          };

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

          // Process signal response to establish connection
          await gameliftstreamsRef.current?.processSignalResponse(data.signalResponse);

          // Update state - now we have gameplay control (Requirement 9.5)
          setGameLiftStatus(StreamState.RUNNING);
          setHasGameplayControl(true);
          setCurrentController(username);
          setIsStreamStarting(false);
          setInputEnabled(false);

          console.log('Successfully connected to GameLift session');

          // For direct broadcast games, the broadcast happens on the GameLift server
          // No need to start IVS broadcast from the browser

          // Update takeover state to 'complete'
          setTakeoverState({
            status: 'complete',
            requesterUsername: null,
            requestTimestamp: null,
            sessionId: null,
          });

          // Success - break out of retry loop
          break;

        } catch (error) {
          lastError = error;
          retryCount++;
          
          console.error(`GameLift connection attempt ${retryCount} failed:`, error);
          
          if (retryCount < maxRetries) {
            // Wait before retrying (exponential backoff)
            const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 3000);
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Reset SDK before retry
            if (gameliftstreamsRef.current) {
              try {
                gameliftstreamsRef.current.close();
                gameliftstreamsRef.current = null;
              } catch (e) {
                console.warn('Error closing GameLift instance before retry:', e);
              }
            }
            resetGameLiftStreamsSDK();
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }

      // If all retries failed, throw the last error
      if (lastError) {
        throw lastError;
      }

      // Clear complete status after a brief moment
      // Store this timeout for cleanup
      const statusTimeout = setTimeout(() => {
        setTakeoverState(prev => {
          if (prev.status === 'complete') {
            return {
              status: 'idle',
              requesterUsername: null,
              requestTimestamp: null,
              sessionId: null,
            };
          }
          return prev;
        });
      }, 2000);
      
      // Store status timeout for cleanup
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
      statusTimeoutRef.current = statusTimeout;

      console.log('Takeover complete - now controlling gameplay');
    } catch (error) {
      console.error('Failed to connect to GameLift session after takeover approval:', error);
      // Requirement 16.4: Handle invalid/expired session IDs
      // Pass 'reconnect' context to provide appropriate error message
      handleGameLiftError(error, 'reconnect');

      // Reset takeover state on error
      setTakeoverState({
        status: 'idle',
        requesterUsername: null,
        requestTimestamp: null,
        sessionId: null,
      });

      setIsStreamStarting(false);
    } finally {
      // Always reset the processing flag when done
      isProcessingTakeoverApprovalRef.current = false;
    }
  };

  /**
   * Handle takeover denial from current controller
   * Implements task 18: Takeover denial handling (requester)
   * Requirements: 13.3
   */
  const handleTakeoverDenial = (message: any) => {
    // Only process if we're the requester
    if (takeoverState.status !== 'requesting') {
      console.log('Ignoring takeover denial - not in requesting state');
      return;
    }

    console.log('Takeover request was denied');

    // Clear timeout (cleanup on state transition)
    if (takeoverTimeoutRef.current) {
      clearTimeout(takeoverTimeoutRef.current);
      takeoverTimeoutRef.current = null;
    }

    // Update takeover state to 'denied' to display notification
    setTakeoverState({
      status: 'denied',
      requesterUsername: null,
      requestTimestamp: null,
      sessionId: null,
    });

    // Clear denied status after 3 seconds to re-enable the request button
    // Store this timeout for cleanup
    const statusTimeout = setTimeout(() => {
      setTakeoverState(prev => {
        if (prev.status === 'denied') {
          return {
            status: 'idle',
            requesterUsername: null,
            requestTimestamp: null,
            sessionId: null,
          };
        }
        return prev;
      });
    }, 3000);
    
    // Store status timeout for cleanup
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = statusTimeout;

    console.log('Takeover denial processed - request button will be re-enabled');
  };

  /**
   * Handle takeover cancellation from current controller
   * Implements task 19: Takeover cancellation handling (requester)
   * Requirements: 17.4
   */
  const handleTakeoverCancellation = (message: any) => {
    // Only process if we're the requester
    if (takeoverState.status !== 'requesting') {
      console.log('Ignoring takeover cancellation - not in requesting state');
      return;
    }

    console.log('Takeover request was cancelled');

    // Clear timeout (cleanup on state transition)
    if (takeoverTimeoutRef.current) {
      clearTimeout(takeoverTimeoutRef.current);
      takeoverTimeoutRef.current = null;
    }

    // Update takeover state to 'cancelled' to display notification
    setTakeoverState({
      status: 'cancelled',
      requesterUsername: null,
      requestTimestamp: null,
      sessionId: null,
    });

    // Clear cancelled status after 3 seconds to re-enable the request button
    // Store this timeout for cleanup
    const statusTimeout = setTimeout(() => {
      setTakeoverState(prev => {
        if (prev.status === 'cancelled') {
          return {
            status: 'idle',
            requesterUsername: null,
            requestTimestamp: null,
            sessionId: null,
          };
        }
        return prev;
      });
    }, 3000);
    
    // Store status timeout for cleanup
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = statusTimeout;

    console.log('Takeover cancellation processed - request button will be re-enabled');
  };



  /**
   * Retry joining stage with publish permissions after capacity opens up
   */
  const retryJoinWithPublish = async () => {
    if (!isSubscribeOnlyMode || !canRetryPublish) {
      console.log('Cannot retry - not in subscribe-only mode or retry not available');
      return;
    }

    try {
      console.log('Retrying to join stage with publish permissions...');
      setCanRetryPublish(false);

      // Request webcam and microphone permissions
      let localMediaStream: MediaStream | null = null;
      try {
        localMediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });
        console.log('Media permissions granted for retry');
      } catch (mediaError) {
        console.warn('Media permissions denied on retry:', mediaError);
        setErrors(prev => [...prev, 'Camera and microphone access denied. Please allow permissions to broadcast.']);
        setCanRetryPublish(true);
        return;
      }

      // Leave the current subscribe-only stage
      await participantStageManagerRef.current.leaveStage();

      // Get new token with publish permissions
      const gameConfig = GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame];
      const participantToken = await participantStageManagerRef.current.fetchParticipantToken(
        username,
        ['PUBLISH', 'SUBSCRIBE'],
        'participant_webcam',
        gameConfig?.supportsCouchCoop
      );

      // Store local webcam stream
      setLocalWebcamStream(localMediaStream);

      // Create LocalStageStream instances from media tracks
      const localStreams = participantStageManagerRef.current.createLocalStreams(localMediaStream);

      // Set up capacity error handler for retry
      capacityErrorHandlerRef.current = (error: any) => {
        console.log('=== Capacity error handler called (retry) ===');
        console.log('Error code:', error.code);
        console.log('Error category:', error.category);
        console.log('Error message:', error.message);
        
        // Check for STAGE_AT_CAPACITY error code (6) or PUBLISH_ERROR category
        if (error.code === 6 || error.message?.includes('Stage at capacity') || error.category === 'PUBLISH_ERROR') {
          console.log('Capacity error detected during retry, triggering handler');
          // Use setTimeout to break out of the callback context
          setTimeout(() => {
            handleStageCapacityError(localMediaStream);
            setCanRetryPublish(true);
            setErrors(prev => [...prev, 'Stage is still at capacity. Please try again when someone leaves.']);
          }, 0);
        } else {
          handleIVSBroadcastError(error, 'webcam');
        }
      };

      // Create and join IVS stage with local streams
      await participantStageManagerRef.current.createStage({
        participantToken,
        streams: localStreams,
        onConnectionStateChange: (state: StageConnectionState) => {
          console.log('Participant stage connection state:', state);
          if (state === StageConnectionState.CONNECTED) {
            setIsWebcamBroadcasting(true);
            
            // Attach local stream to video element for preview
            if (webcamVideoRef.current && localMediaStream) {
              webcamVideoRef.current.srcObject = localMediaStream;
            }
            
            // Clear connection lost errors
            setErrors(prev => prev.filter(e => !e.includes('Connection lost')));
          } else if (state === StageConnectionState.DISCONNECTED) {
            setIsWebcamBroadcasting(false);
            setErrors(prev => [...prev, 'Connection lost. Attempting to reconnect...']);
          }
        },
        onStreamsAdded: handleStreamsAdded,
        onParticipantLeft: handleParticipantLeft,
        onError: (error: Error) => {
          console.error('Participant stage error during retry:', error);
          
          // Call the capacity error handler
          if (capacityErrorHandlerRef.current) {
            capacityErrorHandlerRef.current(error);
          }
        }
      });

      // Join the stage
      await participantStageManagerRef.current.joinStage();
      
      // Success - clear subscribe-only mode
      setIsSubscribeOnlyMode(false);
      isSubscribeOnlyModeRef.current = false;
      setIsWebcamBroadcasting(true);
      
      // Add success message
      const successMessage = 'SUCCESS: Successfully enabled camera and microphone!';
      setErrors(prev => {
        // Remove any "participant left" messages and add success message
        const filtered = prev.filter(e => !e.includes('participant left'));
        if (filtered.includes(successMessage)) return filtered;
        return [...filtered, successMessage];
      });
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setErrors(prev => prev.filter(e => !e.includes('Successfully enabled')));
      }, 3000);
      
      console.log('Successfully rejoined stage with publish permissions');
    } catch (error) {
      console.error('Failed to retry joining with publish permissions:', error);
      let errorMessage = 'Failed to enable camera and microphone.';
      
      if (error instanceof Error) {
        if (error.message.includes('token')) {
          errorMessage = 'Failed to get stage token. Please refresh the page and try again.';
        } else if (error.message.includes('network') || error.message.includes('timeout')) {
          errorMessage = 'Network error. Please check your internet connection.';
        } else {
          errorMessage = `Failed to enable camera: ${error.message}`;
        }
      }
      
      setErrors(prev => [...prev, errorMessage]);
      setCanRetryPublish(true);
    }
  };

  /**
   * Toggle camera on/off
   * Implements requirement 4.2
   * Implements task 28: Announce state changes to screen readers
   */
  const toggleCamera = () => {
    if (!localWebcamStream) return;

    const newCameraState = !isCameraEnabled;
    
    // Get the stage and find video tracks
    const stage = participantStageManagerRef.current.getStage();
    if (stage) {
      const videoTracks = localWebcamStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = newCameraState;
      });
      
      // Refresh stage strategy to apply changes
      stage.refreshStrategy();
    }
    
    setIsCameraEnabled(newCameraState);
    
    // Announce to screen readers
    announceToScreenReader(newCameraState ? 'Camera turned on' : 'Camera turned off');
  };

  /**
   * Toggle microphone on/off
   * Implements requirement 4.3
   * Implements task 28: Announce state changes to screen readers
   */
  const toggleMicrophone = () => {
    if (!localWebcamStream) return;

    const newMicState = !isMicEnabled;
    
    // Get the stage and find audio tracks
    const stage = participantStageManagerRef.current.getStage();
    if (stage) {
      const audioTracks = localWebcamStream.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = newMicState;
      });
      
      // Refresh stage strategy to apply changes
      stage.refreshStrategy();
    }
    
    setIsMicEnabled(newMicState);
    
    // Announce to screen readers
    announceToScreenReader(newMicState ? 'Microphone unmuted' : 'Microphone muted');
  };

  /**
   * Announce message to screen readers via ARIA live region
   * Implements task 28: Add ARIA live regions for notifications
   */
  const announceToScreenReader = (message: string) => {
    setLiveRegionMessage(message);
    // Clear after a short delay to allow for repeated announcements
    setTimeout(() => setLiveRegionMessage(''), 100);
  };

  const toggleChat = () => {
    const newChatState = !isChatOpen;
    setIsChatOpen(newChatState);
    
    // Announce chat state change to screen readers
    if (newChatState) {
      announceToScreenReader('Chat panel opened');
    } else {
      announceToScreenReader('Chat panel closed');
    }
  };

  /**
   * Open settings modal with focus management
   * Implements task 28: Manage focus for modals
   */
  const openSettingsModal = () => {
    // Store current focus for restoration
    previousFocusRef.current = document.activeElement as HTMLElement;
    setShowSettingsModal(true);
    
    // Focus the modal after a brief delay to allow rendering
    setTimeout(() => {
      if (settingsModalRef.current) {
        const closeButton = settingsModalRef.current.querySelector('.btn-close');
        if (closeButton) {
          (closeButton as HTMLButtonElement).focus();
        }
      }
    }, 100);
  };

  /**
   * Close settings modal with focus restoration
   * Implements task 28: Manage focus for modals
   */
  const closeSettingsModal = () => {
    setShowSettingsModal(false);
    
    // Restore focus to the element that opened the modal
    if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  };

  const attachInput = () => {
    gameliftstreamsRef.current?.attachInput();
    setInputEnabled(true);
    announceToScreenReader('Input enabled');
  };

  const detachInput = () => {
    gameliftstreamsRef.current?.detachInput();
    setInputEnabled(false);
    announceToScreenReader('Input disabled');
  };

  /**
   * Stop gameplay session
   * Implements task 11: Stop gameplay button
   * Requirement: 5.5
   */
  const stopGameplaySession = () => {
    console.log('Stopping gameplay session');
    
    // Properly close GameLift connection - this will signal the server to terminate the session
    if (gameliftstreamsRef.current) {
      try {
        gameliftstreamsRef.current.close();
        gameliftstreamsRef.current = null;
        console.log('GameLift connection closed - session will terminate on server');
      } catch (error) {
        console.error('Error closing GameLift connection:', error);
      }
    }

    // Reset state
    setGameLiftStatus(StreamState.STOPPED);
    setHasGameplayControl(false);
    setCurrentController(null);
    setInputEnabled(false);
    setSessionId('');

    // Clear stored session ID
    localStorage.removeItem('lastGameLiftSessionId');
    localStorage.removeItem('lastGameLiftSessionTimestamp');

    // Exit fullscreen if active
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(error => {
        console.error('Error exiting fullscreen:', error);
      });
    }

    // Reset GameLift SDK
    resetGameLiftStreamsSDK();

    console.log('Gameplay session stopped - local cleanup complete');
  };

  /**
   * Toggle fullscreen mode
   * Implements task 11: Fullscreen toggle
   * Requirement: 5.5
   */
  const toggleFullscreen = () => {
    const containerElement = document.getElementById('InteractivePlayTestGameplayContainer');
    
    if (!document.fullscreenElement) {
      // Enter fullscreen
      if (containerElement) {
        // Only attach input if user has gameplay control (is the player with active GameLift session)
        if (hasGameplayControl && gameLiftStatus === StreamState.RUNNING && !inputEnabled) {
          attachInput();
        }
        
        containerElement.requestFullscreen().catch((error) => {
          console.warn('Fullscreen request failed:', error);
        });
        
        // Lock keyboard for better gaming experience (only for players with control)
        if (hasGameplayControl && 'keyboard' in navigator) {
          // @ts-ignore - Keyboard API not fully supported in TypeScript yet
          const keyboard = (navigator as any).keyboard;
          keyboard.lock(['Escape']).catch(() => {});
        }
      }
    } else {
      // Exit fullscreen
      document.exitFullscreen();
    }
  };

  /**
   * Toggle input enable/disable
   * Implements task 11: Input enable/disable toggle
   * Requirement: 5.5
   */
  const toggleInput = () => {
    if (inputEnabled) {
      detachInput();
    } else {
      attachInput();
    }
  };

  // Render role-based actions
  // Implements task 28: Add ARIA labels to all buttons
  const renderRoleBasedActions = () => {
    // console.log('renderRoleBasedActions called:', { userRole, hasGameplayControl, currentController, gameplayStream });
    
    // Show takeover button for anyone without control when there's an active gameplay stream
    // (either from currentController or from gameplayStream presence)
    if (!hasGameplayControl && (currentController || gameplayStream)) {
      console.log('Rendering Request Takeover button');
      const isRequesting = takeoverState.status === 'requesting';
      return (
        <button 
          className="btn btn-primary"
          onClick={requestTakeover}
          disabled={isRequesting}
          aria-label={isRequesting ? 'Waiting for takeover approval' : 'Request takeover of gameplay control'}
          aria-busy={isRequesting}
        >
          {isRequesting ? 'Waiting for approval...' : 'Request Control'}
        </button>
      );
    }
    
    // No start button here - it's controlled from the settings dialog
    return null;
  };

  /**
   * Render gameplay controls (only when user has control)
   * Note: Start/stop game is controlled from settings dialog
   * Note: Input is controlled by clicking on/off the video element
   */
  const renderGameplayControls = () => {
    // No controls needed in sidebar - everything is controlled elsewhere
    return null;
  };

  /**
   * Render takeover status display (for requester)
   * Implements task 12: Show takeover status
   * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
   * Implements task 28: Add ARIA labels to status indicators
   */
  const renderTakeoverStatus = () => {
    if (takeoverState.status === 'idle' || takeoverState.status === 'complete') {
      return null;
    }

    let statusMessage = '';
    let statusClass = '';
    let ariaLabel = '';

    switch (takeoverState.status) {
      case 'requesting':
        statusMessage = 'Waiting for approval...';
        statusClass = 'info';
        ariaLabel = 'Takeover request pending approval';
        break;
      case 'approved':
        statusMessage = 'Takeover approved - connecting...';
        statusClass = 'success';
        ariaLabel = 'Takeover approved, connecting to gameplay session';
        break;
      case 'denied':
        statusMessage = 'Takeover denied';
        statusClass = 'danger';
        ariaLabel = 'Takeover request was denied';
        break;
      case 'cancelled':
        statusMessage = 'Request timed out';
        statusClass = 'warning';
        ariaLabel = 'Takeover request timed out';
        break;
      default:
        return null;
    }

    return (
      <div 
        className={`alert alert-${statusClass}`}
        role="status"
        aria-label={ariaLabel}
      >
        {statusMessage}
      </div>
    );
  };

  // Render takeover notification (for current controller)
  // Implements task 28: Add ARIA labels and manage focus for modals
  const renderTakeoverNotification = () => {
    if (takeoverState.status !== 'pending_approval' || !hasGameplayControl) return null;

    return (
      <div 
        className="modal show d-block modal-backdrop-dark" 
        tabIndex={-1} 
        role="dialog"
        aria-modal="true"
        aria-labelledby="takeover-modal-title"
        aria-describedby="takeover-modal-description"
      >
        <div className="modal-dialog" ref={takeoverModalRef}>
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title" id="takeover-modal-title">Takeover Request</h5>
            </div>
            <div className="modal-body">
              <p id="takeover-modal-description">
                {takeoverState.requesterUsername} is requesting to take over gameplay control.
              </p>
            </div>
            <div className="modal-footer">
              <button 
                className="btn btn-success" 
                onClick={approveTakeover}
                aria-label={`Approve takeover request from ${takeoverState.requesterUsername}`}
              >
                Approve
              </button>
              <button 
                className="btn btn-danger" 
                onClick={denyTakeover}
                aria-label={`Deny takeover request from ${takeoverState.requesterUsername}`}
              >
                Deny
              </button>
              <button 
                className="btn btn-secondary" 
                onClick={dismissTakeover}
                aria-label="Dismiss takeover request without responding"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render participant videos
  // Implements task 28: Add ARIA labels to participant videos
  const renderParticipantVideos = () => {
    return Array.from(participantStreams.values()).map((participant) => {
      const { userId, username: participantUsername, videoStream, audioStream } = participant;
      const isLive = !!videoStream;

      return (
        <div key={userId} className="participant-video-container video-container">
          <div 
            className="stream-status" 
            role="status" 
            aria-label={`${participantUsername}: ${isLive ? 'live' : 'inactive'}`}
          >
            <div className={`status-dot ${isLive ? 'live' : 'inactive'}`} aria-hidden="true"></div>
            <span>{participantUsername}</span>
          </div>
          <video
            ref={(el) => {
              if (el) {
                participantVideoRefs.current.set(userId, el);
                
                let mediaStream = el.srcObject as MediaStream;
                if (!mediaStream) {
                  mediaStream = new MediaStream();
                  el.srcObject = mediaStream;
                }

                if (videoStream?.mediaStreamTrack) {
                  const existingTracks = mediaStream.getVideoTracks();
                  const trackExists = existingTracks.some(t => t.id === videoStream.mediaStreamTrack.id);
                  if (!trackExists) {
                    mediaStream.addTrack(videoStream.mediaStreamTrack);
                  }
                }

                if (audioStream?.mediaStreamTrack) {
                  const existingTracks = mediaStream.getAudioTracks();
                  const trackExists = existingTracks.some(t => t.id === audioStream.mediaStreamTrack.id);
                  if (!trackExists) {
                    mediaStream.addTrack(audioStream.mediaStreamTrack);
                  }
                }

                // Ensure the video element is not muted so volume control works
                el.muted = false;
                el.volume = 1;
              }
            }}
            autoPlay
            playsInline
            className="video-cover"
            aria-label={`${participantUsername}'s video feed`}
          />

          {/* Volume Control for Remote Participant Video */}
          {isLive && (
            <VolumeControl
              mediaElement={participantVideoRefs.current.get(userId) || null}
              initialVolume={1}
              className="participant-volume-control"
              onVolumeChange={(volume, muted) => {
                // For IVS participant streams, control the video element directly
                const videoElement = participantVideoRefs.current.get(userId);
                if (videoElement) {
                  videoElement.volume = volume;
                  videoElement.muted = muted;
                }
              }}
            />
          )}
          {!videoStream && (
            <div className="offline-message" role="status">
              <p>Participant video not active</p>
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="playtester-container">
      {/* ARIA Live Region for screen reader announcements */}
      {/* Implements task 28: Add ARIA live regions for notifications */}
      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only-live-region"
      >
        {liveRegionMessage}
      </div>

      {/* Header */}
      <nav className="navbar navbar-expand-lg navbar-dark playtester-header" role="banner">
        <div className="container-fluid">
          <div className="navbar-brand">
            <h2 className="mb-0">Interactive Play Testing</h2>
            <div className="header-username-container">
              <span className="username" aria-label={`Logged in as ${username}, role: ${userRole}`}>
                @{username}
              </span>
              <span className="role-badge">
                ({userRole})
              </span>
              {selectedGame && (
                <span className="game-badge" title={`Selected game: ${selectedGame}`}>
                  {selectedGame}
                </span>
              )}
            </div>
          </div>
          <button 
            className="navbar-toggler border-0" 
            type="button" 
            onClick={() => setIsNavCollapsed(!isNavCollapsed)}
            aria-controls="navbarNav" 
            aria-expanded={!isNavCollapsed} 
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon"></span>
          </button>
          <div className={`collapse navbar-collapse ${!isNavCollapsed ? 'show' : ''}`} id="navbarNav">
            <div className="navbar-nav ms-auto" role="navigation" aria-label="Main navigation">
              <button 
                className="control-button" 
                onClick={() => navigate('/')}
                aria-label="Go back to home page"
              >
                <i className="bi bi-arrow-left" aria-hidden="true"></i> Back
              </button>
              {userRole === 'player' && (
                <button 
                  className="control-button" 
                  onClick={openSettingsModal}
                  aria-label="Open settings"
                >
                  <i className="bi bi-gear" aria-hidden="true"></i> Settings
                </button>
              )}
              <button 
                className="control-button" 
                onClick={signOut}
                aria-label="Sign out"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Error Messages */}
      {/* Implements task 28: Add ARIA labels to status indicators */}
      {errors.length > 0 && (
        <div role="alert" aria-live="assertive" style={{ marginTop: '1rem' }}>
          {errors.slice(-3).map((error, sliceIndex) => {
            const isSuccess = error.startsWith('SUCCESS:');
            const displayMessage = isSuccess ? error.replace('SUCCESS: ', '') : error;
            
            return (
              <div 
                key={`${error}-${sliceIndex}`}
                className={isSuccess ? "success-banner" : "error-banner"}
                style={{ marginBottom: '0.5rem' }}
              >
                <span>{displayMessage}</span>
                <button
                  onClick={() => {
                    console.log('Close button clicked for message:', error);
                    setErrors(prev => {
                      // Find and remove this specific error message
                      const indexToRemove = prev.lastIndexOf(error);
                      if (indexToRemove !== -1) {
                        const newErrors = [...prev.slice(0, indexToRemove), ...prev.slice(indexToRemove + 1)];
                        console.log('Removed message at index:', indexToRemove);
                        console.log('New errors array length:', newErrors.length);
                        return newErrors;
                      }
                      return prev;
                    });
                  }}
                  aria-label="Dismiss message"
                  className="error-dismiss-inline"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Takeover Status Display */}
      {renderTakeoverStatus()}

      {/* Main Content */}
      <div className="playtester-content" role="main">
        {/* Gameplay Area */}
        <section className="gameplay-area" aria-label="Gameplay video">
          <div 
            className="gameplay-video-container video-container" 
            id="InteractivePlayTestGameplayContainer"
            role="region"
            aria-label={hasGameplayControl ? 'Your gameplay stream' : 'Gameplay broadcast'}
          >
            {/* GameLift video elements - always rendered but hidden when not in use */}
            <video
              ref={gameLiftVideoRef}
              id="InteractivePlayTestGameLiftVideo"
              autoPlay
              playsInline
              muted
              className={hasGameplayControl && gameLiftStatus === StreamState.RUNNING ? 'video-visible' : 'video-hidden'}
              aria-label="Your gameplay video stream"
            />
            <audio 
              ref={gameLiftAudioRef} 
              id="InteractivePlayTestGameLiftAudio" 
              autoPlay 
              aria-label="Gameplay audio"
            />

            {/* Volume Control for GameLift Audio */}
            {hasGameplayControl && gameLiftStatus === StreamState.RUNNING && (
              <VolumeControl
                mediaElement={gameLiftAudioRef.current}
                initialVolume={1}
                className="gameplay-volume-control"
              />
            )}

            {/* Fullscreen Toggle Button */}
            {(hasGameplayControl && gameLiftStatus === StreamState.RUNNING) || (!hasGameplayControl && gameplayStream) ? (
              <button
                className="fullscreen-toggle-btn"
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              >
                <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
              </button>
            ) : null}

            {/* Show status when user has gameplay control */}
            {hasGameplayControl && gameLiftStatus === StreamState.RUNNING && (
              <div className="stream-status">
                <div className="status-dot live"></div>
                <span>LIVE - Direct Broadcast Active</span>
              </div>
            )}

            {/* Show IVS broadcast when user doesn't have gameplay control */}
            {!hasGameplayControl && gameplayStream && (
              <>
                <div className="stream-status">
                  <div className="status-dot live"></div>
                  <span>LIVE - Viewing Broadcast</span>
                </div>
                <video
                  key={gameplayStream?.mediaStreamTrack?.id || 'gameplay-video'}
                  ref={(el) => {
                    if (el) {
                      ivsGameplayVideoRef.current = el;
                      setIvsGameplayVideoElement(el); // Set state for VolumeControl
                      let mediaStream = el.srcObject as MediaStream;
                      if (!mediaStream) {
                        mediaStream = new MediaStream();
                        el.srcObject = mediaStream;
                        console.log('Created new MediaStream for gameplay');
                      }

                      // Add video track if available
                      if (gameplayStream?.mediaStreamTrack) {
                        const existingVideoTracks = mediaStream.getVideoTracks();
                        const videoTrackExists = existingVideoTracks.some(t => t.id === gameplayStream.mediaStreamTrack.id);
                        if (!videoTrackExists) {
                          mediaStream.addTrack(gameplayStream.mediaStreamTrack);
                          console.log('Added gameplay video track to MediaStream');
                        }
                      }

                      // Add audio track if available
                      if (gameplayAudioStream?.mediaStreamTrack) {
                        const existingAudioTracks = mediaStream.getAudioTracks();
                        const audioTrackExists = existingAudioTracks.some(t => t.id === gameplayAudioStream.mediaStreamTrack.id);
                        if (!audioTrackExists) {
                          mediaStream.addTrack(gameplayAudioStream.mediaStreamTrack);
                          console.log('Added gameplay audio track to MediaStream');
                        }
                      }

                      // Ensure the video element is not muted so volume control works
                      el.muted = false;
                      el.volume = 1;
                    } else {
                      setIvsGameplayVideoElement(null);
                    }
                  }}
                  autoPlay
                  playsInline
                  className="video-visible"
                  aria-label="Live gameplay broadcast from current controller"
                />

                {/* Volume Control for IVS Gameplay Stream */}
                {ivsGameplayVideoElement && (
                  <VolumeControl
                    mediaElement={ivsGameplayVideoElement}
                    initialVolume={1}
                    className="gameplay-volume-control"
                    onVolumeChange={(volume, muted) => {
                      // For IVS streams, we need to control the video element's volume directly
                      console.log('IVS Gameplay Volume Control:', ivsGameplayVideoElement);
                      if (ivsGameplayVideoElement) {
                        ivsGameplayVideoElement.volume = volume;
                        ivsGameplayVideoElement.muted = muted;
                      }
                    }}
                  />
                )}
                
                {/* Show Request Takeover button for anyone without control */}
                {!hasGameplayControl && (
                  <div className="takeover-button-container">
                    {renderRoleBasedActions()}
                  </div>
                )}
              </>
            )}

            {/* Loading overlay */}
            {isStreamStarting && (
              <div className="loading-overlay" role="status" aria-live="polite">
                <div className="spinner" aria-hidden="true"></div>
                <div>Starting GameLift Stream Session...</div>
              </div>
            )}

            {/* Input Status Indicator - Auto-hides after 5 seconds */}
            {hasGameplayControl && gameLiftStatus === StreamState.RUNNING && showInputIndicator && !inputEnabled && (
              <div className="input-status-indicator inactive">
                Click on gameplay to enable input
              </div>
            )}
            {hasGameplayControl && gameLiftStatus === StreamState.RUNNING && showInputIndicator && inputEnabled && (
              <div className="input-status-indicator active">
                ✓ Input Active (click outside to disable)
              </div>
            )}

            {/* No gameplay message */}
            {!hasGameplayControl && !gameplayStream && !isStreamStarting && (
              <div className="offline-message">
                <h3>No Gameplay Stream</h3>
                <p>Use the Settings dialog to start a gameplay session or wait for someone else to start one.</p>
                {renderRoleBasedActions()}
              </div>
            )}
          </div>
        </section>

        {/* Participants Sidebar */}
        <aside className="participants-sidebar" aria-label="Participant video feeds">
          {/* Gameplay Controls - shown above webcam */}
          {renderGameplayControls()}
          {/* Local Webcam */}
          <div className="webcam-video-container video-container">
            <div className="stream-status" role="status" aria-label={`Your webcam: ${isWebcamBroadcasting ? 'live' : 'inactive'}`}>
              <div className={`status-dot ${isWebcamBroadcasting ? 'live' : 'inactive'}`} aria-hidden="true"></div>
              <span>You</span>
            </div>
            <video
              ref={webcamVideoRef}
              autoPlay
              playsInline
              muted
              className="video-cover"
              aria-label="Your webcam video"
            />

            {/* Show retry button when in subscribe-only mode due to capacity */}
            {isSubscribeOnlyMode && canRetryPublish && (
              <div className="offline-message" role="status">
                <p>Stage at capacity</p>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={retryJoinWithPublish}
                  aria-label="Enable camera and microphone"
                >
                  Enable Camera
                </button>
              </div>
            )}

            {/* Show message when in subscribe-only mode but can't retry yet */}
            {isSubscribeOnlyMode && !canRetryPublish && (
              <div className="offline-message" role="status">
                <p>Stage at capacity</p>
                <p className="text-muted small">Waiting for space...</p>
              </div>
            )}

            {isWebcamBroadcasting && (
              <div className="media-controls" role="toolbar" aria-label="Media controls">
                <button
                  className={`media-control-btn ${!isCameraEnabled ? 'muted' : ''}`}
                  onClick={toggleCamera}
                  title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                  aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
                  aria-pressed={isCameraEnabled}
                >
                  <i className={`bi ${isCameraEnabled ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`} aria-hidden="true"></i>
                </button>
                <button
                  className={`media-control-btn ${!isMicEnabled ? 'muted' : ''}`}
                  onClick={toggleMicrophone}
                  title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  aria-label={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
                  aria-pressed={isMicEnabled}
                >
                  <i className={`bi ${isMicEnabled ? 'bi-mic-fill' : 'bi-mic-mute-fill'}`} aria-hidden="true"></i>
                </button>
              </div>
            )}
          </div>

          {/* Participant Videos */}
          {renderParticipantVideos()}
        </aside>
      </div>

      {/* Chat Toggle Button */}
      <button 
        className="chat-toggle-button" 
        onClick={toggleChat}
        aria-label={`${isChatOpen ? 'Close' : 'Open'} chat${unreadMessageCount > 0 ? `, ${unreadMessageCount} unread messages` : ''}`}
        aria-expanded={isChatOpen}
        aria-controls="chat-panel"
      >
        <i className="bi bi-chat-dots-fill" aria-hidden="true"></i>
        {unreadMessageCount > 0 && (
          <span className="chat-badge" aria-label={`${unreadMessageCount} unread messages`}>
            {unreadMessageCount > 99 ? '99+' : unreadMessageCount}
          </span>
        )}
      </button>

      {/* Chat Off-Canvas Panel */}
      <aside 
        id="chat-panel"
        className={`chat-offcanvas ${isChatOpen ? 'open' : ''}`}
        aria-label="Chat panel"
        aria-hidden={!isChatOpen}
      >
        <div className="chat-offcanvas-header">
          <h3>Chat</h3>
          <button 
            className="close-button" 
            onClick={toggleChat}
            aria-label="Close chat panel"
          >
            ×
          </button>
        </div>
        <div className="chat-offcanvas-body">
          <ChatComponent username={username} chatClient={chatClient} hideHeader={true} removeRoundedCorners={true} />
        </div>
      </aside>

      {/* Backdrop for off-canvas panel */}
      {isChatOpen && (
        <div 
          className="chat-backdrop" 
          onClick={toggleChat}
          aria-hidden="true"
        />
      )}

      {/* Takeover Notification Modal */}
      {renderTakeoverNotification()}

      {/* Settings Modal - Only show for player role */}
      {userRole === 'player' && (
        <SettingsModal
          showModal={showSettingsModal}
          onClose={closeSettingsModal}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          showOnlyDirectBroadcastGames={true}
          
          // GameLift State
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
          
          // Broadcast State (not used for direct broadcast but required by interface)
          isGameplayBroadcasting={false}
          isGameplayBroadcastStarting={false}
          isWebcamBroadcasting={isWebcamBroadcasting}
          isWebcamBroadcastStarting={false}
          demoMode={demoMode}
          
          // Broadcast Config
          broadcastConfig={broadcastConfig}
          
          // Event Handlers
          onGameSelectionChange={handleGameSelectionChange}
          setSgId={setSgId}
          setAppId={setAppId}
          setRegions={setRegions}
          setSessionId={setSessionId}
          setDemoMode={setDemoMode}
          setBroadcastConfig={setBroadcastConfig}
          
          // Action Handlers
          onStartGame={startGameplaySession}
          onStopGame={stopGameplaySession}
          onReconnect={() => {
            // Implement reconnect logic if needed
            console.log('Reconnect not implemented for Interactive Play Test');
          }}
          onStartGameplayBroadcast={() => {
            // Not used in direct broadcast mode
            console.log('Manual gameplay broadcast not available in direct broadcast mode');
          }}
          onStopGameplayBroadcast={() => {
            // Not used in direct broadcast mode
            console.log('Manual gameplay broadcast not available in direct broadcast mode');
          }}
          onStartWebcamBroadcast={() => {
            // Webcam broadcast is handled automatically
            console.log('Webcam broadcast is handled automatically');
          }}
          onStopWebcamBroadcast={() => {
            // Webcam broadcast is handled automatically
            console.log('Webcam broadcast is handled automatically');
          }}
        />
      )}
    </div>
  );
};

export default InteractivePlayTestView;
