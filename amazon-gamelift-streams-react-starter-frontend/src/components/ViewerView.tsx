/**
 * ViewerView Component
 * Main viewer interface with gameplay area, webcam area, and chat
 * Subscribes to IVS Real-time stage to receive player streams
 */

import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stage, StageConnectionState } from 'amazon-ivs-web-broadcast';
import { AppSyncChatClient } from '../utils/AppSyncChatClient';
import { IVSStageManager } from '../utils/IVSStageManager';
import { ChatComponent } from './ChatComponent';
import { VolumeControl } from './VolumeControl';
import { generateUsername } from '../utils/usernameGenerator';
import { ENABLE_REMOTE_PLAYER_CONTROL, STREAM_SOURCE } from '../utils/constants';
import { getAppSyncConfig } from '../utils/configService';
import { MessageTransport, createCouchCoopTransport } from '../utils/transports';
import { RemoteStageStream } from '../types/ivs.types';
import { ControlMessage, isViewerInviteMessage, isViewerInviteCancelledMessage } from '../types/chat.types';
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
  const [participantWebcamStream, setParticipantWebcamStream] = useState<RemoteStageStream | null>(null);
  const [participantWebcamUsername, setParticipantWebcamUsername] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // UI State
  const [username] = useState(generateUsername());
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isNavCollapsed, setIsNavCollapsed] = useState(true);
  
  // Couch Co-op Control State
  const [isPlayerSpawned, setIsPlayerSpawned] = useState(false);
  const isPlayerSpawnedRef = useRef(false); // Ref to track spawn state for closures
  const [isVideoFocused, setIsVideoFocused] = useState(false);
  const [gameSupportsCouch, setGameSupportsCouch] = useState(false);

  // Viewer Invite State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviterUsername, setInviterUsername] = useState<string | null>(null);
  const [isJoiningAsPublisher, setIsJoiningAsPublisher] = useState(false);
  const [isBroadcastingWebcam, setIsBroadcastingWebcam] = useState(false);
  const [localWebcamStream, setLocalWebcamStream] = useState<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [webcamStage, setWebcamStage] = useState<Stage | null>(null);
  const [webcamStageStreams, setWebcamStageStreams] = useState<any[]>([]);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const webcamStageManagerRef = useRef<IVSStageManager>(new IVSStageManager());
  const localWebcamVideoRef = useRef<HTMLVideoElement>(null);
  const participantWebcamVideoRef = useRef<HTMLVideoElement>(null);
  const inviteModalRef = useRef<HTMLDivElement>(null);

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
  
  // Gamepad state tracking
  const gamepadIndexRef = useRef<number | null>(null);
  
  // Inactivity tracking
  const lastActivityRef = useRef<number>(Date.now());
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityTimeout = 5000 * 10000; // 5 seconds (configurable)

  // Chat Client
  const [chatClient] = useState(() => new AppSyncChatClient(getAppSyncConfig()));

  // Couch Co-op Transport (may use AppSync or PubNub depending on COUCH_COOP_TRANSPORT flag)
  const couchTransportRef = useRef<MessageTransport | null>(null);

  // Handle control messages for viewer invites
  const handleControlMessage = (message: ControlMessage) => {
    console.log('ViewerView received control message:', message);

    if (isViewerInviteMessage(message)) {
      // Check if this invite is for us
      if (message.invitedUsername === username) {
        console.log('Received invite from:', message.inviterUsername);
        setInviterUsername(message.inviterUsername);
        setShowInviteModal(true);
        
        // Focus the modal after rendering
        setTimeout(() => {
          if (inviteModalRef.current) {
            const firstButton = inviteModalRef.current.querySelector('button');
            if (firstButton) {
              (firstButton as HTMLButtonElement).focus();
            }
          }
        }, 100);
      }
    } else if (isViewerInviteCancelledMessage(message)) {
      // Player cancelled the invite
      if (message.inviterUsername === inviterUsername) {
        console.log('Invite cancelled by:', message.inviterUsername);
        setShowInviteModal(false);
        setInviterUsername(null);
        
        // If we were already broadcasting, stop
        if (isBroadcastingWebcam) {
          leaveWebcamStage();
        }
      }
    }
  };

  // Register control message handler
  useEffect(() => {
    chatClient.onControlMessage(handleControlMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, inviterUsername, isBroadcastingWebcam]);

  // Attach local webcam stream to video element when it becomes available
  useEffect(() => {
    if (localWebcamStream && localWebcamVideoRef.current && isBroadcastingWebcam) {
      const previewStream = new MediaStream([localWebcamStream.getVideoTracks()[0]]);
      localWebcamVideoRef.current.srcObject = previewStream;
      console.log('Attached local webcam stream to video element');
    }
  }, [localWebcamStream, isBroadcastingWebcam]);

  // Attach participant webcam stream to video element when it becomes available
  useEffect(() => {
    if (participantWebcamStream && participantWebcamVideoRef.current) {
      const stream = participantWebcamStream as any;
      const mediaStreamTrack = stream.mediaStreamTrack;
      
      if (mediaStreamTrack) {
        let existingMediaStream = participantWebcamVideoRef.current.srcObject as MediaStream;
        
        if (!existingMediaStream) {
          existingMediaStream = new MediaStream();
          participantWebcamVideoRef.current.srcObject = existingMediaStream;
        }
        
        const existingTracks = existingMediaStream.getTracks();
        const trackExists = existingTracks.some(t => t.id === mediaStreamTrack.id);
        
        if (!trackExists) {
          existingMediaStream.addTrack(mediaStreamTrack);
          console.log('Attached participant webcam stream to video element');
        }
      }
    }
  }, [participantWebcamStream]);

  /**
   * Accept the invite and join the webcam stage as a publisher
   */
  const acceptInvite = async () => {
    if (!inviterUsername) return;

    setShowInviteModal(false);
    setIsJoiningAsPublisher(true);

    try {
      // Request user media (camera and microphone)
      const userMediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      setLocalWebcamStream(userMediaStream);

      // Fetch participant token with PUBLISH capability and participant_webcam source
      const participantToken = await webcamStageManagerRef.current.fetchParticipantToken(
        username,
        ['PUBLISH'],
        STREAM_SOURCE.PARTICIPANT_WEBCAM as 'participant_webcam'
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
          console.log('Viewer webcam stage connection state:', state);
          if (state === StageConnectionState.CONNECTED) {
            console.log('Successfully connected to webcam stage as publisher');
            setIsBroadcastingWebcam(true);
            setIsJoiningAsPublisher(false);

            // Send acceptance message
            sendInviteAccepted();
          } else if (state === StageConnectionState.DISCONNECTED) {
            setIsBroadcastingWebcam(false);
          }
        },
        onError: (error) => {
          console.error('Viewer webcam stage error:', error);
          setErrors(prev => [...prev, `Failed to join stream: ${error.message}`]);
          setIsJoiningAsPublisher(false);
        }
      });

      // Join the stage
      await webcamStageManagerRef.current.joinStage();
      setWebcamStage(stage);

      console.log('Successfully joined webcam stage as publisher');
    } catch (error) {
      console.error('Failed to accept invite:', error);
      setErrors(prev => [...prev, `Failed to join stream: ${error instanceof Error ? error.message : 'Unknown error'}`]);
      setIsJoiningAsPublisher(false);
      setInviterUsername(null);
      
      // Send decline message since we failed
      sendInviteDeclined();
    }
  };

  /**
   * Decline the invite
   */
  const declineInvite = async () => {
    setShowInviteModal(false);
    await sendInviteDeclined();
    setInviterUsername(null);
  };

  /**
   * Send invite accepted message
   */
  const sendInviteAccepted = async () => {
    try {
      const acceptMessage = {
        action: 'VIEWER_INVITE_ACCEPTED',
        invitedUsername: username,
        timestamp: Date.now()
      };

      await (chatClient as any).publishRaw(acceptMessage);
      console.log('Sent invite accepted message');
    } catch (error) {
      console.error('Failed to send invite accepted message:', error);
    }
  };

  /**
   * Send invite declined message
   */
  const sendInviteDeclined = async () => {
    try {
      const declineMessage = {
        action: 'VIEWER_INVITE_DECLINED',
        invitedUsername: username,
        timestamp: Date.now()
      };

      await (chatClient as any).publishRaw(declineMessage);
      console.log('Sent invite declined message');
    } catch (error) {
      console.error('Failed to send invite declined message:', error);
    }
  };

  /**
   * Leave the webcam stage and notify the player
   */
  const leaveWebcamStage = async () => {
    try {
      // Send left stage message
      const leftMessage = {
        action: 'VIEWER_LEFT_STAGE',
        viewerUsername: username,
        timestamp: Date.now()
      };

      await (chatClient as any).publishRaw(leftMessage);
      console.log('Sent viewer left stage message');
    } catch (error) {
      console.error('Failed to send left stage message:', error);
    }

    // Leave the stage
    if (webcamStageManagerRef.current.isActive()) {
      await webcamStageManagerRef.current.leaveStage();
    }

    // Stop local media tracks
    if (localWebcamStream) {
      localWebcamStream.getTracks().forEach(track => track.stop());
      setLocalWebcamStream(null);
    }

    // Clear video element
    if (localWebcamVideoRef.current) {
      localWebcamVideoRef.current.srcObject = null;
    }

    setWebcamStage(null);
    setIsBroadcastingWebcam(false);
    setInviterUsername(null);
    setWebcamStageStreams([]);
    setIsCameraEnabled(true);
    setIsMicEnabled(true);
  };

  /**
   * Toggle webcam camera on/off
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

  // Initialize on mount
  useEffect(() => {
    // Copy refs to variables at effect creation time
    const stageManager = stageManagerRef.current;
    const webcamManager = webcamStageManagerRef.current;
    const client = chatClient;

    // Cleanup on unmount
    return () => {
      if (stageManager.isActive()) {
        stageManager.leaveStage();
      }
      if (webcamManager.isActive()) {
        webcamManager.leaveStage();
      }
      client.disconnect();
      
      // Disconnect couch co-op transport
      if (couchTransportRef.current) {
        couchTransportRef.current.disconnect();
        couchTransportRef.current = null;
      }
      
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

  // Detect gamepad connection
  useEffect(() => {
    const handleGamepadConnected = (e: GamepadEvent) => {
      console.log('Gamepad connected:', e.gamepad.id);
      gamepadIndexRef.current = e.gamepad.index;
    };

    const handleGamepadDisconnected = (e: GamepadEvent) => {
      console.log('Gamepad disconnected');
      if (gamepadIndexRef.current === e.gamepad.index) {
        gamepadIndexRef.current = null;
      }
    };

    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    return () => {
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
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
   * Publish a couch co-op event via the configured transport.
   * Uses the transport ref directly — no silent fallback to AppSync.
   */
  const publishCouchCoopEvent = async (event: any): Promise<void> => {
    const transport = couchTransportRef.current;
    if (!transport) {
      console.warn('[CouchCoop] Transport not initialized — is the stage connected?');
      throw new Error('Couch co-op transport not initialized');
    }
    if (!transport.isReady()) {
      console.warn('[CouchCoop] Transport not ready, attempting reconnect...');
      await transport.connect();
    }
    await transport.publishRaw(event);
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

      // Publish spawn event via couch co-op transport
      await publishCouchCoopEvent(spawnEvent);
      
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

      // Publish despawn event via couch co-op transport
      await publishCouchCoopEvent(despawnEvent);
      
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

      // Publish move event via couch co-op transport
      await publishCouchCoopEvent(moveEvent);
      
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

    // Poll gamepad state
    const gamepads = navigator.getGamepads();
    if (gamepadIndexRef.current !== null) {
      const gamepad = gamepads[gamepadIndexRef.current];
      
      if (gamepad) {
        // Read left stick with deadzone
        const leftStickX = Math.abs(gamepad.axes[0]) > 0.15 ? gamepad.axes[0] : 0;
        const leftStickY = Math.abs(gamepad.axes[1]) > 0.15 ? gamepad.axes[1] : 0;

        // Convert stick to key presses
        if (leftStickX < -0.5) pressedKeysRef.current.add('ArrowLeft');
        else pressedKeysRef.current.delete('ArrowLeft');

        if (leftStickX > 0.5) pressedKeysRef.current.add('ArrowRight');
        else pressedKeysRef.current.delete('ArrowRight');

        if (leftStickY < -0.5) pressedKeysRef.current.add('ArrowUp');
        else pressedKeysRef.current.delete('ArrowUp');

        if (leftStickY > 0.5) pressedKeysRef.current.add('ArrowDown');
        else pressedKeysRef.current.delete('ArrowDown');

        // Read buttons
        if (gamepad.buttons[0]?.pressed) pressedKeysRef.current.add(' '); // A button = Fire
        else pressedKeysRef.current.delete(' ');

        if (gamepad.buttons[2]?.pressed) pressedKeysRef.current.add('k'); // X button = Shield
        else pressedKeysRef.current.delete('k');

        // Reset inactivity on any input
        if (leftStickX !== 0 || leftStickY !== 0 || gamepad.buttons[0]?.pressed || gamepad.buttons[2]?.pressed) {
          resetInactivityTimer();
        }
      }
    }

    const currentKeys = Array.from(pressedKeysRef.current).sort();
    
    // Debounce spacebar to prevent spam (only send every 100ms)
    // BUT always send on initial press (spacebarJustPressedRef)
    const hasSpacebar = currentKeys.includes(' ');
    const timeSinceLastSpace = now - lastSpacebarSentRef.current;
    
    let keysToSend = currentKeys;
    
    if (hasSpacebar) {
      // Always send if just pressed, otherwise debounce
      if (spacebarJustPressedRef.current || timeSinceLastSpace >= 250) {
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
    const supportedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'k', 'w', 'a', 's', 'd'];
    
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
    const supportedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'k', 'w', 'a', 's', 'd'];
    
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
        onParticipantLeft: (participantInfo) => {
          console.log('Participant left:', participantInfo);
          const streamSource = participantInfo?.attributes?.stream_source;
          
          // Clear the appropriate stream based on what source left
          if (streamSource === 'gameplay') {
            setGameplayStream(null);
            if (gameplayVideoRef.current) {
              gameplayVideoRef.current.srcObject = null;
            }
          } else if (streamSource === 'player_webcam') {
            setWebcamStream(null);
            if (webcamVideoRef.current) {
              webcamVideoRef.current.srcObject = null;
            }
          } else if (streamSource === 'participant_webcam') {
            setParticipantWebcamStream(null);
            setParticipantWebcamUsername(null);
            if (participantWebcamVideoRef.current) {
              participantWebcamVideoRef.current.srcObject = null;
            }
          }
        },
        onError: (error) => {
          console.error('Viewer stage error:', error);
          setErrors(prev => [...prev, `Stage error: ${error.message}`]);
          setIsConnecting(false);
        }
      });

      // Join the stage
      await stageManagerRef.current.joinStage();

      // Initialize couch co-op transport (PubNub or AppSync depending on feature flag)
      if (!couchTransportRef.current) {
        couchTransportRef.current = createCouchCoopTransport(chatClient, username);
        await couchTransportRef.current.connect();
      }

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
      } else if (streamSource === 'participant_webcam') {
        // Handle invited viewer's webcam stream
        setParticipantWebcamStream(stream);
        
        // Get the participant's username from their userId
        const participantUsername = participantInfo?.userId || 'Viewer';
        setParticipantWebcamUsername(participantUsername);
        console.log('Participant webcam from:', participantUsername);
        
        // Get or create MediaStream for participant webcam video element
        if (participantWebcamVideoRef.current) {
          let existingMediaStream = participantWebcamVideoRef.current.srcObject as MediaStream;
          
          if (!existingMediaStream) {
            // Create new MediaStream if none exists
            existingMediaStream = new MediaStream();
            participantWebcamVideoRef.current.srcObject = existingMediaStream;
          }
          
          // Add the track if it's not already present
          const existingTracks = existingMediaStream.getTracks();
          const trackExists = existingTracks.some(t => t.id === mediaStreamTrack.id);
          
          if (!trackExists) {
            existingMediaStream.addTrack(mediaStreamTrack);
            console.log(`✓ Added ${trackKind} track to participant webcam stream`);
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
        <nav className="navbar navbar-expand-lg navbar-dark view-header p-2">
          <div className="container-fluid">
            <div className="navbar-brand d-flex">
              <h2 className="mb-0">Amazon GameLift Streams + IVS (Viewer)</h2>
              <div className="align-self-center d-none d-lg-flex">
                <span className="ms-3 username">@{username}</span>
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
              <div className="navbar-nav ms-auto">
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
          </div>
        </nav>

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
                {ENABLE_REMOTE_PLAYER_CONTROL && gameSupportsCouch && (
                  <div className="broadcast-status" style={{ marginLeft: '8px' }}>
                    <div className={`status-dot ${isVideoFocused ? '' : 'inactive'}`}></div>
                    <span>{isVideoFocused ? 'Controls Active' : 'Click to control'}{gamepadIndexRef.current !== null && ' 🎮'}</span>
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
            {/* Webcam Area (Area 2) */}
            <div className="webcam-video-container video-container">
              {/* Collapse Sidebar Button */}
              <button
                className="collapse-sidebar-btn"
                onClick={() => setIsSidebarCollapsed(true)}
                title="Hide chat"
              >
                <i className="bi bi-chevron-right"></i>
              </button>
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

            {/* Participant Webcam - shown when another viewer is broadcasting */}
            {participantWebcamStream && !isBroadcastingWebcam && (
              <div className="participant-webcam-video-container video-container">
                {/* Broadcast Status Indicator */}
                <div className="broadcast-status">
                  <div className="status-dot"></div>
                  <span>{participantWebcamUsername || 'Viewer'} - LIVE</span>
                </div>

                {/* Participant Webcam Video */}
                <video
                  ref={participantWebcamVideoRef}
                  autoPlay
                  playsInline
                />

                {/* Volume Control for Participant Webcam Stream */}
                {isConnected && participantWebcamStream && (
                  <VolumeControl
                    mediaElement={participantWebcamVideoRef.current}
                    initialVolume={1}
                    className="participant-webcam-volume-control"
                  />
                )}
              </div>
            )}

            {/* Local Webcam Preview - shown when viewer is broadcasting */}
            {isBroadcastingWebcam && (
              <div className="local-webcam-video-container video-container">
                {/* Status Indicator */}
                <div className="broadcast-status">
                  <div className="status-dot"></div>
                  <span>You - LIVE</span>
                </div>

                {/* Local Webcam Video */}
                <video
                  ref={localWebcamVideoRef}
                  autoPlay
                  playsInline
                  muted
                />

                {/* Media Controls */}
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

                {/* Leave Button */}
                <button
                  className="leave-stage-btn"
                  onClick={leaveWebcamStage}
                  title="Leave stream"
                  aria-label="Leave stream"
                >
                  <i className="bi bi-box-arrow-right"></i>
                </button>
              </div>
            )}

            {/* Joining as Publisher Loading */}
            {isJoiningAsPublisher && (
              <div className="local-webcam-video-container video-container">
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <div>Joining stream...</div>
                </div>
              </div>
            )}

            {/* Chat Area (Area 3) */}
            <div className="chat-container">
              <ChatComponent username={username} chatClient={chatClient} isSidebarCollapsed={isSidebarCollapsed} />
            </div>
          </div>
        </div>

        {/* Viewer Invite Modal */}
        {showInviteModal && (
          <div 
            className="modal show d-block modal-backdrop-dark" 
            tabIndex={-1} 
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-modal-title"
            aria-describedby="invite-modal-description"
          >
            <div className="modal-dialog" ref={inviteModalRef}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title" id="invite-modal-title">Stream Invitation</h5>
                </div>
                <div className="modal-body">
                  <p id="invite-modal-description">
                    <strong>{inviterUsername}</strong> is inviting you to join their stream!
                  </p>
                  <p className="text-muted small">
                    If you accept, your camera and microphone will be shared with the stream.
                  </p>
                </div>
                <div className="modal-footer">
                  <button 
                    className="btn btn-success" 
                    onClick={acceptInvite}
                    aria-label={`Accept invitation from ${inviterUsername}`}
                  >
                    <i className="bi bi-camera-video-fill"></i> Accept
                  </button>
                  <button 
                    className="btn btn-danger" 
                    onClick={declineInvite}
                    aria-label={`Decline invitation from ${inviterUsername}`}
                  >
                    Decline
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ViewerView;
