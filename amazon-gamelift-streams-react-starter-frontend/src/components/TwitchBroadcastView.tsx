/**
 * TwitchBroadcastView Component
 * Dedicated interface for broadcasting GameLift gameplay to Twitch using IVS Web Broadcast SDK
 */

import React, { useState, useEffect, useRef } from 'react';
import * as gameliftstreamssdk from '../gamelift-streams-websdk/gameliftstreams-1.0.0';
import { ApiError, get, post } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AppSyncChatClient } from '../utils/AppSyncChatClient';
import { ChatComponent } from './ChatComponent';
import { generateUsername } from '../utils/usernameGenerator';
import { GAMELIFT_STREAMS_CONFIG } from '../utils/constants';
import { getAppSyncConfig } from '../utils/configService';
import IVSBroadcastClient, { BASIC_LANDSCAPE } from 'amazon-ivs-web-broadcast';

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

interface TwitchBroadcastViewProps {
  user: any;
  signOut?: () => void;
}

export enum StreamState {
  STOPPED = 1,
  LOADING,
  RUNNING,
  ERROR
}

export const TwitchBroadcastView: React.FC<TwitchBroadcastViewProps> = ({ user, signOut }) => {
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

  // Twitch Broadcast State
  const [twitchStreamKey, setTwitchStreamKey] = useState('');
  const [broadcastClient, setBroadcastClient] = useState<ReturnType<typeof IVSBroadcastClient.create> | null>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isBroadcastStarting, setIsBroadcastStarting] = useState(false);

  // Webcam State
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [isWebcamEnabled, setIsWebcamEnabled] = useState(false);
  const [isWebcamStarting, setIsWebcamStarting] = useState(false);

  // UI State
  const [showSettingsModal, setShowSettingsModal] = useState(true);
  const [username] = useState(generateUsername());
  const [errors, setErrors] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isOffscreenCanvasSupported] = useState(() => typeof OffscreenCanvas !== 'undefined');
  const [showInputIndicator, setShowInputIndicator] = useState(true);

  // Refs
  const gameLiftVideoRef = useRef<HTMLVideoElement>(null);
  const gameLiftAudioRef = useRef<HTMLAudioElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const gameliftstreamsRef = useRef<gameliftstreamssdk.GameLiftStreams | null>(null);
  const webcamVideoRef = useRef<HTMLVideoElement>(null);

  // Chat Client
  const [chatClient] = useState(() => new AppSyncChatClient(getAppSyncConfig()));

  // Initialize GameLift Streams SDK on mount
  useEffect(() => {
    resetGameLiftStreamsSDK();

    // Check browser compatibility
    const compatibilityErrors: string[] = [];
    
    // Check for OffscreenCanvas support
    if (typeof OffscreenCanvas === 'undefined') {
      compatibilityErrors.push(
        'Warning: OffscreenCanvas is not supported in this browser. Twitch broadcasting will not be available. Please use Chrome 69+, Edge 79+, or Firefox 105+ for full functionality.'
      );
    }
    
    // Check for captureStream support (including Firefox's mozCaptureStream)
    const testVideo = document.createElement('video');
    const hasCaptureStream = typeof testVideo.captureStream === 'function' || 
                             typeof (testVideo as any).mozCaptureStream === 'function';
    if (!hasCaptureStream) {
      compatibilityErrors.push(
        'Warning: captureStream is not supported in this browser. Stream capture will not work. Please use Chrome 51+, Firefox 43+, or Edge 79+ for stream capture functionality.'
      );
    }
    
    // Check for WebRTC support
    if (!window.RTCPeerConnection) {
      compatibilityErrors.push(
        'Warning: WebRTC is not supported in this browser. Twitch broadcasting requires WebRTC. Please use a modern browser with WebRTC support.'
      );
    }
    
    // Display all compatibility warnings
    if (compatibilityErrors.length > 0) {
      setErrors((prev) => [...prev, ...compatibilityErrors]);
    }

    // Cleanup on unmount
    return () => {
      if (gameliftstreamsRef.current) {
        gameliftstreamsRef.current.close();
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

      const gameplayContainer = document.getElementById('TwitchGameplayContainer');
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

  const attachInput = () => {
    gameliftstreamsRef.current?.attachInput();
    setInputEnabled(true);
  };

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
    }
  };

  const resetGameLiftStreamsSDK = () => {
    gameliftstreamsRef.current = new gameliftstreamssdk.GameLiftStreams({
      videoElement: gameLiftVideoRef.current || document.getElementById('TwitchGameLiftVideo') as HTMLVideoElement,
      audioElement: gameLiftAudioRef.current || document.getElementById('TwitchGameLiftAudio') as HTMLAudioElement,
      inputConfiguration: {
        setCursor: 'visibility',
        autoPointerLock: 'fullscreen'
      },
      clientConnection: {}
    });
  };

  // GameLift Stream Methods
  /**
   * Handle GameLift stream errors with user-friendly messages
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
   */
  const handleTimeout = (arn: string) => {
    const message = `Timeout waiting for stream session: ${arn}`;
    console.error('Polling timed out:', message);
    setErrors(prev => [...prev, 'Stream session creation timed out. This can happen when no compute resources are available. Please try again in a few moments.']);
    setIsStreamStarting(false);
  };

  /**
   * Create a new GameLift stream session
   */
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

  /**
   * Reconnect to an existing GameLift stream session
   */
  const createStreamSessionConnection = async () => {
    setIsStreamStarting(true);
    setErrors([]);
    
    const signalRequest = await gameliftstreamsRef.current?.generateSignalRequest();
    const payload = {
      SessionIdentifier: sessionId,
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
   * Poll for stream session to become ACTIVE
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
          await startStream(data.signalResponse);
          setLastSessionId(arn);
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
   */
  const startStream = async (signalResponse: any) => {
    console.log('Starting GameLift stream');
    
    try {
      await gameliftstreamsRef.current?.processSignalResponse(signalResponse);
      setGameLiftStatus(StreamState.RUNNING);
      setIsStreamStarting(false);
      setInputEnabled(false);
    } catch (error) {
      console.error('Failed to start stream:', error);
      handleError(error);
    }
  };

  /**
   * Close GameLift stream connection
   */
  const closeConnection = () => {
    // Stop Twitch broadcast if active
    if (isBroadcasting) {
      stopTwitchBroadcast();
    }

    setGameLiftStatus(StreamState.STOPPED);
    setInputEnabled(false);
    
    gameliftstreamsRef.current?.close();
    resetGameLiftStreamsSDK();
    setIsStreamStarting(false);

    if (document.fullscreenElement) {
      document.exitFullscreen();
    }
  };

  /**
   * Toggle fullscreen mode
   */
  const toggleFullScreen = () => {
    const containerElement = document.getElementById('TwitchGameplayContainer');
    
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

  // Twitch Broadcast Methods
  /**
   * Create and configure IVS Broadcast Client
   */
  const createBroadcastClient = (): ReturnType<typeof IVSBroadcastClient.create> => {
    console.log('Creating IVS Broadcast Client');
    
    // Check if OffscreenCanvas is supported
    if (typeof OffscreenCanvas === 'undefined') {
      throw new Error('OffscreenCanvas is not supported in this browser. Please use a modern browser like Chrome (version 69+), Edge (version 79+), or Firefox (version 105+) for Twitch broadcasting.');
    }
    
    try {
      const client = IVSBroadcastClient.create({
        streamConfig: BASIC_LANDSCAPE,
        ingestEndpoint: 'g.webrtc.live-video.net',
      });

      // Create OffscreenCanvas with dimensions 854x480 (BASIC_LANDSCAPE resolution)
      const offscreenCanvas = new OffscreenCanvas(854, 480);
      offscreenCanvasRef.current = offscreenCanvas;
      console.log('OffscreenCanvas created with dimensions 854x480');

      // Attach offscreen canvas to broadcast client
      // Note: IVS SDK types expect HTMLCanvasElement, but OffscreenCanvas works for broadcast processing
      client.attachPreview(offscreenCanvas as unknown as HTMLCanvasElement);
      console.log('OffscreenCanvas attached to broadcast client');

      return client;
    } catch (error) {
      console.error('Failed to create broadcast client:', error);
      throw new Error(`Failed to initialize broadcast client: ${error instanceof Error ? error.message : 'Unknown error'}. Please check your browser compatibility and try again.`);
    }
  };

  /**
   * Capture video stream from GameLift video element
   * Uses cross-browser compatible method (supports Firefox's mozCaptureStream)
   */
  const captureGameLiftVideo = (): MediaStream => {
    if (!gameLiftVideoRef.current) {
      throw new Error('GameLift video element not available. Please ensure the GameLift stream is running.');
    }

    console.log('Capturing GameLift video stream at 30 fps');
    
    try {
      return captureVideoStream(gameLiftVideoRef.current, 30); // 30 fps
    } catch (error) {
      console.error('Failed to capture video stream:', error);
      throw new Error(`Failed to capture video stream: ${error instanceof Error ? error.message : 'Unknown error'}. Please ensure the GameLift stream is active.`);
    }
  };

  /**
   * Capture audio stream from GameLift audio element
   * Uses cross-browser compatible method (supports Firefox's mozCaptureStream)
   */
  const captureGameLiftAudio = (): MediaStream => {
    if (!gameLiftAudioRef.current) {
      throw new Error('GameLift audio element not available. Please ensure the GameLift stream is running.');
    }

    console.log('Capturing GameLift audio stream');
    
    try {
      return captureAudioStream(gameLiftAudioRef.current);
    } catch (error) {
      console.error('Failed to capture audio stream:', error);
      throw new Error(`Failed to capture audio stream: ${error instanceof Error ? error.message : 'Unknown error'}. Please ensure the GameLift stream is active.`);
    }
  };

  /**
   * Create combined stream with video and audio tracks
   */
  const createCombinedStream = (): MediaStream => {
    const videoStream = captureGameLiftVideo();
    const audioStream = captureGameLiftAudio();

    // Create a new MediaStream with video tracks
    const combinedStream = new MediaStream(videoStream.getVideoTracks());

    // Add audio tracks
    audioStream.getAudioTracks().forEach((track) => {
      combinedStream.addTrack(track);
    });

    console.log('Combined stream created with video and audio tracks');
    return combinedStream;
  };

  // Webcam Methods
  /**
   * Start webcam capture with microphone
   */
  const startWebcam = async () => {
    setIsWebcamStarting(true);
    setErrors([]);

    try {
      console.log('Starting webcam with microphone...');
      
      // Request user media (camera and microphone)
      const userMediaStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true // Include microphone audio for broadcast
      });

      setWebcamStream(userMediaStream);

      // Display webcam in local video element (muted to prevent echo)
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = userMediaStream;
      }

      setIsWebcamEnabled(true);
      setIsWebcamStarting(false);

      console.log('Successfully started webcam with microphone');
    } catch (error) {
      console.error('Failed to start webcam:', error);
      setErrors((prev) => [...prev, `Failed to start webcam: ${error instanceof Error ? error.message : 'Unknown error'}. Please ensure camera and microphone permissions are granted.`]);
      setIsWebcamStarting(false);
    }
  };

  /**
   * Stop webcam capture
   */
  const stopWebcam = () => {
    if (webcamStream) {
      webcamStream.getTracks().forEach(track => track.stop());
      setWebcamStream(null);
    }

    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }

    setIsWebcamEnabled(false);
    console.log('Stopped webcam');
  };

  /**
   * Start broadcasting to Twitch
   */
  const startTwitchBroadcast = async () => {
    // Validate stream key exists
    if (!twitchStreamKey) {
      setErrors((prev) => [...prev, 'Twitch stream key is required. Please enter your stream key in the settings.']);
      return;
    }

    // Validate GameLift stream is running
    if (gameLiftStatus !== StreamState.RUNNING) {
      setErrors((prev) => [...prev, 'GameLift stream must be running before broadcasting. Please start the GameLift stream first.']);
      return;
    }

    // Check browser compatibility before starting
    if (typeof OffscreenCanvas === 'undefined') {
      setErrors((prev) => [
        ...prev,
        'OffscreenCanvas is not supported in this browser. Please use a modern browser like Chrome (version 69+), Edge (version 79+), or Firefox (version 105+) for Twitch broadcasting.'
      ]);
      return;
    }
    
    // Check for captureStream support
    if (gameLiftVideoRef.current && !gameLiftVideoRef.current.captureStream) {
      setErrors((prev) => [
        ...prev,
        'captureStream is not supported in this browser. Please use Chrome 51+, Firefox 43+, or Edge 79+ for stream capture functionality.'
      ]);
      return;
    }
    
    // Check for WebRTC support
    if (!window.RTCPeerConnection) {
      setErrors((prev) => [
        ...prev,
        'WebRTC is not supported in this browser. Twitch broadcasting requires WebRTC. Please use a modern browser with WebRTC support.'
      ]);
      return;
    }

    setIsBroadcastStarting(true);
    setErrors([]);

    try {
      console.log('Starting Twitch broadcast...');

      // Create broadcast client (with OffscreenCanvas)
      const client = createBroadcastClient();

      // Capture GameLift streams
      const combinedStream = createCombinedStream();

      // Add video input device (gameplay)
      const videoTracks = combinedStream.getVideoTracks();
      if (videoTracks.length > 0) {
        const videoStream = new MediaStream([videoTracks[0]]);
        await client.addVideoInputDevice(videoStream, 'gameplay-video', {
          index: 0,
          width: 854,
          height: 480,
          x: 0,
          y: 0,
        });
        console.log('Gameplay video input device added to broadcast client');
      } else {
        throw new Error('No video tracks available from GameLift stream. Please ensure the GameLift stream is active.');
      }

      // Add webcam video input device if enabled
      if (isWebcamEnabled && webcamStream) {
        const webcamVideoTracks = webcamStream.getVideoTracks();
        if (webcamVideoTracks.length > 0) {
          const webcamVideoStream = new MediaStream([webcamVideoTracks[0]]);
          
          // Position webcam on the right side, vertically centered
          // Canvas is 854x480, webcam is 200px wide with 16:9 aspect ratio (200x112.5)
          // Right side: x = 854 - 200 = 654
          // Vertically centered: y = (480 - 112.5) / 2 = 183.75 ≈ 184
          // Note: The webcam video element has CSS cropping applied (20px from each side)
          await client.addVideoInputDevice(webcamVideoStream, 'webcam-video', {
            index: 1,
            width: 200,
            height: 112, // 16:9 aspect ratio (rounded)
            x: 654,
            y: 184,
          });
          console.log('Webcam video input device added to broadcast client');
        }
      }

      // Add gameplay audio input device
      const audioTracks = combinedStream.getAudioTracks();
      if (audioTracks.length > 0) {
        const audioStream = new MediaStream([audioTracks[0]]);
        await client.addAudioInputDevice(audioStream, 'gameplay-audio');
        console.log('Gameplay audio input device added to broadcast client');
      } else {
        console.warn('No audio tracks available from GameLift stream. Broadcasting without gameplay audio.');
      }

      // Add microphone audio input device if webcam is enabled
      if (isWebcamEnabled && webcamStream) {
        const micAudioTracks = webcamStream.getAudioTracks();
        if (micAudioTracks.length > 0) {
          const micAudioStream = new MediaStream([micAudioTracks[0]]);
          await client.addAudioInputDevice(micAudioStream, 'microphone-audio');
          console.log('Microphone audio input device added to broadcast client');
        } else {
          console.warn('No microphone audio tracks available. Broadcasting without microphone.');
        }
      }

      // Start broadcast
      await client.startBroadcast(twitchStreamKey);

      setBroadcastClient(client);
      setIsBroadcasting(true);
      setIsBroadcastStarting(false);

      console.log('Successfully started Twitch broadcast');
    } catch (error) {
      console.error('Failed to start Twitch broadcast:', error);
      
      // Provide user-friendly error messages based on error type
      let errorMessage = 'Failed to start broadcast: ';
      
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        
        if (message.includes('stream key') || message.includes('authentication') || message.includes('unauthorized')) {
          errorMessage += 'Invalid stream key. Please verify your Twitch stream key and try again.';
        } else if (message.includes('offscreencanvas')) {
          errorMessage += 'Browser compatibility issue. Please use Chrome 69+, Edge 79+, or Firefox 105+.';
        } else if (message.includes('capturestream')) {
          errorMessage += 'Your browser does not support stream capture. Please use a modern browser.';
        } else if (message.includes('video') || message.includes('audio')) {
          errorMessage += error.message;
        } else if (message.includes('network') || message.includes('connection')) {
          errorMessage += 'Network error. Please check your internet connection and try again.';
        } else if (message.includes('ingest') || message.includes('endpoint')) {
          errorMessage += 'Unable to connect to Twitch servers. Please try again in a few moments.';
        } else {
          errorMessage += error.message;
        }
      } else {
        errorMessage += 'Unknown error occurred. Please try again.';
      }
      
      setErrors((prev) => [...prev, errorMessage]);
      setIsBroadcastStarting(false);
      
      // Clean up any partially created client
      if (broadcastClient) {
        try {
          await broadcastClient.stopBroadcast();
        } catch (cleanupError) {
          console.error('Error cleaning up broadcast client:', cleanupError);
        }
        setBroadcastClient(null);
      }
    }
  };

  /**
   * Stop broadcasting to Twitch
   */
  const stopTwitchBroadcast = async () => {
    if (!broadcastClient) {
      return;
    }

    try {
      console.log('Stopping Twitch broadcast...');
      await broadcastClient.stopBroadcast();
      setBroadcastClient(null);
      setIsBroadcasting(false);

      console.log('Successfully stopped Twitch broadcast');
    } catch (error) {
      console.error('Failed to stop Twitch broadcast:', error);
      
      // Provide user-friendly error message
      let errorMessage = 'Failed to stop broadcast cleanly';
      if (error instanceof Error) {
        errorMessage += `: ${error.message}`;
      }
      errorMessage += '. The broadcast may have already ended.';
      
      setErrors((prev) => [...prev, errorMessage]);
      
      // Force cleanup even if stop failed
      setBroadcastClient(null);
      setIsBroadcasting(false);
    }
  };

  return (
    <>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0% { 
              opacity: 1;
              transform: scale(1);
            }
            50% { 
              opacity: 0.6;
              transform: scale(1.1);
            }
            100% { 
              opacity: 1;
              transform: scale(1);
            }
          }
          @keyframes glow {
            0% {
              box-shadow: 0 0 5px rgba(220, 53, 69, 0.5);
            }
            50% {
              box-shadow: 0 0 20px rgba(220, 53, 69, 0.8), 0 0 30px rgba(220, 53, 69, 0.6);
            }
            100% {
              box-shadow: 0 0 5px rgba(220, 53, 69, 0.5);
            }
          }
          .twitch-broadcast-view-container {
            display: flex;
            flex-direction: column;
            height: 100vh;
            background-color: #1a1a2e;
          }
          .twitch-broadcast-view-header {
            background-color: #0f1729;
            padding: 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .twitch-broadcast-view-header h2 {
            color: #e94560;
            margin: 0;
            font-size: 1.5rem;
          }
          .twitch-broadcast-view-header .username {
            color: #4ecdc4;
            font-size: 1rem;
          }
          .twitch-broadcast-view-content {
            display: flex;
            flex: 1;
            overflow: hidden;
          }
          .gameplay-area {
            flex: 1;
            display: flex;
            flex-direction: column;
            padding: 1rem;
            background-color: #1a1a2e;
          }
          .sidebar {
            width: 350px;
            display: flex;
            flex-direction: column;
            background-color: #16213e;
          }
          .video-container {
            position: relative;
            background-color: #000;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
            transition: box-shadow 0.3s ease;
          }
          .video-container:hover {
            box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
          }
          .gameplay-video-container {
            flex: 1;
            position: relative;
          }
          .webcam-video-container {
            height: 200px;
            margin: 1rem 1rem 0 1rem;
            border: 2px solid #0f3460;
          }
          .video-container video, .video-container canvas {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }
          .broadcast-status {
            position: absolute;
            top: 10px;
            right: 10px;
            background: rgba(15, 23, 41, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(78, 205, 196, 0.2);
            padding: 0.6rem 1.2rem;
            border-radius: 24px;
            display: flex;
            align-items: center;
            gap: 0.6rem;
            color: white;
            font-size: 0.95rem;
            font-weight: 600;
            z-index: 10;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            transition: all 0.3s ease;
          }
          .broadcast-status.live {
            background: rgba(220, 53, 69, 0.15);
            border-color: rgba(220, 53, 69, 0.5);
            animation: glow 2s infinite;
          }
          .broadcast-status.offline {
            background: rgba(108, 117, 125, 0.15);
            border-color: rgba(108, 117, 125, 0.3);
          }
          .status-dot {
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background-color: #dc3545;
            animation: pulse 1.5s ease-in-out infinite;
            box-shadow: 0 0 8px rgba(220, 53, 69, 0.6);
          }
          .status-dot.inactive {
            background-color: #6c757d;
            animation: none;
            box-shadow: none;
          }
          .status-text {
            letter-spacing: 0.5px;
            text-transform: uppercase;
            font-size: 0.85rem;
          }
          .status-text.live {
            color: #dc3545;
          }
          .status-text.offline {
            color: #adb5bd;
          }
          .loading-overlay {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(26, 26, 46, 0.9);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            z-index: 20;
            animation: fadeIn 0.3s ease;
          }
          @keyframes fadeIn {
            from {
              opacity: 0;
            }
            to {
              opacity: 1;
            }
          }
          .spinner {
            width: 48px;
            height: 48px;
            border: 4px solid rgba(78, 205, 196, 0.2);
            border-top: 4px solid #4ecdc4;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-bottom: 1.5rem;
            box-shadow: 0 0 20px rgba(78, 205, 196, 0.3);
          }
          .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            padding: 1rem;
            background: linear-gradient(180deg, rgba(22, 33, 62, 0.8) 0%, rgba(22, 33, 62, 1) 100%);
          }
          .error-banner {
            background: rgba(220, 53, 69, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-left: 4px solid #dc3545;
            color: white;
            padding: 0.75rem 1rem;
            margin: 0.5rem 1rem;
            border-radius: 8px;
            font-size: 0.9rem;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
            animation: slideIn 0.3s ease;
          }
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          .settings-button {
            background: rgba(15, 52, 96, 0.8);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(78, 205, 196, 0.3);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            font-weight: 500;
          }
          .settings-button:hover {
            background: rgba(26, 77, 122, 0.9);
            border-color: rgba(78, 205, 196, 0.5);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          }
          .settings-button:active {
            transform: translateY(0);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          }
          
          /* Fullscreen Toggle Button */
          .fullscreen-toggle-btn {
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            width: 40px;
            height: 40px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 15;
            transition: all 0.3s ease;
            opacity: 0.7;
          }
          .fullscreen-toggle-btn:hover {
            opacity: 1;
            background: rgba(0, 0, 0, 0.6);
            border-color: rgba(78, 205, 196, 0.4);
            transform: scale(1.1);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          }
          .fullscreen-toggle-btn:active {
            transform: scale(1.05);
          }
          .fullscreen-toggle-btn i {
            font-size: 18px;
          }
          
          /* Modal Glassmorphism Styles */
          .modal {
            backdrop-filter: blur(5px);
            -webkit-backdrop-filter: blur(5px);
          }
          .modal-content {
            background: rgba(22, 33, 62, 0.95) !important;
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid rgba(78, 205, 196, 0.2);
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            color: #ffffff;
          }
          .modal-header {
            background: rgba(15, 23, 41, 0.6);
            border-bottom: 1px solid rgba(78, 205, 196, 0.2);
            border-radius: 12px 12px 0 0;
          }
          .modal-title {
            color: #4ecdc4;
            font-weight: 600;
          }
          .modal-body {
            background: transparent;
          }
          .modal-body h6 {
            color: #e94560;
            font-weight: 600;
          }
          .modal-footer {
            background: rgba(15, 23, 41, 0.6);
            border-top: 1px solid rgba(78, 205, 196, 0.2);
            border-radius: 0 0 12px 12px;
          }
          .form-label {
            color: #b8a9d1;
            font-weight: 500;
            margin-bottom: 0.5rem;
          }
          .form-control, .form-select {
            background: rgba(15, 23, 41, 0.6) !important;
            border: 1px solid rgba(78, 205, 196, 0.3) !important;
            color: #ffffff !important;
            border-radius: 8px;
            padding: 0.6rem;
            transition: all 0.2s;
          }
          .form-control:focus, .form-select:focus {
            background: rgba(15, 23, 41, 0.8) !important;
            border-color: rgba(78, 205, 196, 0.6) !important;
            box-shadow: 0 0 0 0.2rem rgba(78, 205, 196, 0.25) !important;
            outline: none;
          }
          .form-control::placeholder {
            color: rgba(184, 169, 209, 0.5);
          }
          .card {
            background: rgba(15, 23, 41, 0.6) !important;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(78, 205, 196, 0.2) !important;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          }
          .card-body {
            color: #ffffff;
          }
          .card-title {
            color: #4ecdc4;
            font-size: 0.95rem;
            font-weight: 600;
          }
          .card-text {
            color: #b8a9d1;
            font-size: 0.9rem;
          }
          .btn {
            border-radius: 8px;
            padding: 0.5rem 1rem;
            font-weight: 500;
            transition: all 0.2s;
            border: 1px solid transparent;
          }
          .btn-success {
            background: rgba(40, 167, 69, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-color: rgba(40, 167, 69, 0.5);
          }
          .btn-success:hover {
            background: rgba(40, 167, 69, 1);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          .btn-danger {
            background: rgba(220, 53, 69, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-color: rgba(220, 53, 69, 0.5);
          }
          .btn-danger:hover {
            background: rgba(220, 53, 69, 1);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          .btn-warning {
            background: rgba(255, 193, 7, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-color: rgba(255, 193, 7, 0.5);
            color: #000;
          }
          .btn-warning:hover {
            background: rgba(255, 193, 7, 1);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          .btn-info {
            background: rgba(23, 162, 184, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-color: rgba(23, 162, 184, 0.5);
          }
          .btn-info:hover {
            background: rgba(23, 162, 184, 1);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          .btn-primary {
            background: rgba(0, 123, 255, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-color: rgba(0, 123, 255, 0.5);
          }
          .btn-primary:hover {
            background: rgba(0, 123, 255, 1);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          .btn-secondary {
            background: rgba(108, 117, 125, 0.9);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border-color: rgba(108, 117, 125, 0.5);
          }
          .btn-secondary:hover {
            background: rgba(108, 117, 125, 1);
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
          }
          .btn-close {
            filter: invert(1);
            opacity: 0.8;
          }
          .btn-close:hover {
            opacity: 1;
          }
          .btn:disabled {
            cursor: not-allowed;
            opacity: 0.6;
          }
          .input-status-indicator {
            position: absolute;
            bottom: 10px;
            left: 10px;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(78, 205, 196, 0.3);
            padding: 0.5rem 1rem;
            border-radius: 8px;
            color: white;
            font-size: 0.9rem;
            z-index: 5;
            transition: opacity 0.3s ease;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
            pointer-events: none;
          }
          .input-status-indicator.disabled {
            background: rgba(15, 23, 41, 0.85);
            border-color: rgba(78, 205, 196, 0.3);
          }
          .input-status-indicator.enabled {
            background: rgba(76, 175, 80, 0.85);
            border-color: rgba(255, 255, 255, 0.3);
          }
        `}
      </style>

      <div className="twitch-broadcast-view-container">
        {/* Header */}
        <div className="twitch-broadcast-view-header">
          <div>
            <h2>Twitch Broadcast View</h2>
            <span className="username">@{username}</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="settings-button" onClick={() => setShowSettingsModal(true)}>
              <i className="bi bi-gear"></i> Settings
            </button>
            {signOut && (
              <button className="settings-button" onClick={signOut}>
                Sign Out
              </button>
            )}
          </div>
        </div>

        {/* Error Messages */}
        {errors.length > 0 && (
          <div>
            {errors.slice(-3).map((error, index) => (
              <div key={index} className="error-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{error}</span>
                <button
                  onClick={() => setErrors(prev => prev.filter((_, i) => i !== prev.length - 3 + index))}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                    padding: '0 0.5rem',
                    marginLeft: '1rem'
                  }}
                  aria-label="Dismiss error"
                >
                  ×
                </button>
              </div>
            ))}
            {errors.length > 3 && (
              <div className="error-banner" style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                + {errors.length - 3} more error{errors.length - 3 !== 1 ? 's' : ''}
                <button
                  onClick={() => setErrors([])}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    marginLeft: '0.5rem'
                  }}
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        )}

        {/* Main Content */}
        <div className="twitch-broadcast-view-content">
          {/* Gameplay Area */}
          <div className="gameplay-area">
            <div className="gameplay-video-container video-container" id="TwitchGameplayContainer">
              {/* Broadcast Status Indicator */}
              {gameLiftStatus === StreamState.RUNNING && (
                <div className={`broadcast-status ${isBroadcasting ? 'live' : 'offline'}`}>
                  <div className={`status-dot ${isBroadcasting ? '' : 'inactive'}`}></div>
                  <span className={`status-text ${isBroadcasting ? 'live' : 'offline'}`}>
                    {isBroadcasting ? 'LIVE - Broadcasting to Twitch' : 'Broadcast Offline'}
                  </span>
                </div>
              )}

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

              {/* GameLift Video - muted because audio is played separately */}
              <video
                ref={gameLiftVideoRef}
                id="TwitchGameLiftVideo"
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />

              {/* GameLift Audio - Player should hear this (not muted) */}
              <audio ref={gameLiftAudioRef} id="TwitchGameLiftAudio" autoPlay />

              {/* Preview Canvas for Broadcast */}
              <canvas
                ref={previewCanvasRef}
                id="TwitchBroadcastPreview"
                style={{ 
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  display: isBroadcasting ? 'block' : 'none',
                  pointerEvents: 'none'
                }}
              />

              {/* Loading Overlay for GameLift Stream */}
              {isStreamStarting && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <div>Starting GameLift Stream Session...</div>
                  <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.8 }}>
                    This may take up to 30 seconds
                  </div>
                </div>
              )}

              {/* Loading Overlay for Broadcast Start */}
              {isBroadcastStarting && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <div>Starting Twitch Broadcast...</div>
                  <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.8 }}>
                    Initializing broadcast client and capturing streams
                  </div>
                </div>
              )}

              {/* Input Status Indicator - Auto-hides after 5 seconds */}
              {gameLiftStatus === StreamState.RUNNING && showInputIndicator && !inputEnabled && (
                <div className="input-status-indicator disabled">
                  Click on gameplay to enable input
                </div>
              )}
              {gameLiftStatus === StreamState.RUNNING && showInputIndicator && inputEnabled && (
                <div className="input-status-indicator enabled">
                  ✓ Input Active (click outside to disable)
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="sidebar">
            {/* Webcam Area */}
            <div className="webcam-video-container video-container">
              {/* Webcam Status Indicator */}
              <div className="broadcast-status">
                <div className={`status-dot ${isWebcamEnabled ? '' : 'inactive'}`}></div>
                <span>{isWebcamEnabled ? 'Webcam Active' : 'Webcam Off'}</span>
              </div>

              {/* Webcam Video (muted to prevent echo) */}
              {/* CSS cropping: scale up and clip to remove 20px from each side */}
              <video
                ref={webcamVideoRef}
                id="TwitchWebcamVideo"
                autoPlay
                playsInline
                muted
                style={{ 
                  width: '100%', 
                  height: '100%', 
                  objectFit: 'cover',
                  transform: 'scale(1.067)', // Scale up to crop (640 / (640-40) ≈ 1.067)
                  transformOrigin: 'center center'
                }}
              />

              {/* Loading Overlay */}
              {isWebcamStarting && (
                <div className="loading-overlay">
                  <div className="spinner"></div>
                  <div>Starting Webcam...</div>
                </div>
              )}
            </div>

            {/* Chat Area */}
            <div className="chat-container">
              <ChatComponent username={username} chatClient={chatClient} />
            </div>
          </div>
        </div>

        {/* Settings Modal */}
        {showSettingsModal && (
          <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Twitch Broadcast Settings</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setShowSettingsModal(false)}
                  ></button>
                </div>
                <div className="modal-body">
                  {/* GameLift Configuration */}
                  <h6 className="mb-3">GameLift Stream Configuration</h6>
                  <div className="row g-3 mb-4">
                    <div className="col-md-12">
                      <label htmlFor="gameSelection" className="form-label">Game Selection</label>
                      <select
                        className="form-select"
                        id="gameSelection"
                        value={selectedGame}
                        onChange={(e) => handleGameSelectionChange(e.target.value)}
                      >
                        {Object.keys(GAMELIFT_STREAMS_CONFIG.gameLibrary).map((gameName) => (
                          <option key={gameName} value={gameName}>
                            {gameName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label htmlFor="sgId" className="form-label">Stream Group ID</label>
                      <input
                        type="text"
                        className="form-control"
                        id="sgId"
                        value={sgId}
                        onChange={(e) => setSgId(e.target.value.trim())}
                        placeholder="sg-xxxxxxx"
                      />
                    </div>
                    <div className="col-md-6">
                      <label htmlFor="appId" className="form-label">Application ID</label>
                      <input
                        type="text"
                        className="form-control"
                        id="appId"
                        value={appId}
                        onChange={(e) => setAppId(e.target.value.trim())}
                        placeholder="a-xxxxxxx"
                      />
                    </div>
                    <div className="col-md-6">
                      <label htmlFor="region" className="form-label">Region</label>
                      <select
                        className="form-select"
                        id="region"
                        onChange={(e) => setRegions([e.target.value])}
                        value={regions[0]}
                      >
                        <option value="ap-northeast-1">ap-northeast-1</option>
                        <option value="eu-central-1">eu-central-1</option>
                        <option value="eu-west-1">eu-west-1</option>
                        <option value="us-east-1">us-east-1</option>
                        <option value="us-east-2">us-east-2</option>
                        <option value="us-west-2">us-west-2</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label htmlFor="sessionId" className="form-label">Session ID (for reconnect)</label>
                      <input
                        type="text"
                        className="form-control"
                        id="sessionId"
                        value={sessionId || lastSessionId}
                        onChange={(e) => setSessionId(e.target.value.trim())}
                        placeholder="Session ID"
                      />
                    </div>
                  </div>

                  {/* Twitch Configuration */}
                  <h6 className="mb-3">Twitch Configuration</h6>
                  <div className="row g-3 mb-4">
                    <div className="col-12">
                      <label htmlFor="twitchStreamKey" className="form-label">Stream Key</label>
                      <input
                        type="password"
                        className="form-control"
                        id="twitchStreamKey"
                        value={twitchStreamKey}
                        onChange={(e) => setTwitchStreamKey(e.target.value.trim())}
                        placeholder="Enter your Twitch stream key"
                      />
                    </div>
                  </div>

                  {/* Broadcast Status */}
                  <h6 className="mb-3">Broadcast Status</h6>
                  <div className="row g-3">
                    <div className="col-md-4">
                      <div className="card">
                        <div className="card-body">
                          <h6 className="card-title">Twitch Broadcast</h6>
                          <p className="card-text">
                            Status: <strong>{isBroadcasting ? 'LIVE' : 'Offline'}</strong>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="card">
                        <div className="card-body">
                          <h6 className="card-title">Webcam</h6>
                          <p className="card-text">
                            Status: <strong>{isWebcamEnabled ? 'Active' : 'Off'}</strong>
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="card">
                        <div className="card-body">
                          <h6 className="card-title">Browser Compatibility</h6>
                          <p className="card-text">
                            OffscreenCanvas: <strong style={{ color: isOffscreenCanvasSupported ? '#28a745' : '#dc3545' }}>
                              {isOffscreenCanvasSupported ? 'Supported ✓' : 'Not Supported ✗'}
                            </strong>
                          </p>
                          {!isOffscreenCanvasSupported && (
                            <p className="card-text" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                              Use Chrome 69+, Edge 79+, or Firefox 105+
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <div className="d-flex justify-content-between w-100">
                    <div className="d-flex gap-2">
                      {/* GameLift Stream Controls */}
                      <button
                        className={`btn ${gameLiftStatus !== StreamState.RUNNING ? 'btn-success' : 'btn-danger'}`}
                        onClick={gameLiftStatus !== StreamState.RUNNING ? createStreamSession : closeConnection}
                        disabled={isStreamStarting}
                      >
                        {isStreamStarting && (
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        )}
                        {gameLiftStatus !== StreamState.RUNNING ? 'Start GameLift Stream' : 'Stop GameLift Stream'}
                      </button>

                      {sessionId && (
                        <button
                          className="btn btn-warning"
                          onClick={createStreamSessionConnection}
                          disabled={isStreamStarting}
                        >
                          Reconnect
                        </button>
                      )}

                      {/* Fullscreen Control */}
                      {gameLiftStatus === StreamState.RUNNING && (
                        <button
                          className="btn btn-primary"
                          onClick={toggleFullScreen}
                        >
                          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                        </button>
                      )}

                      {/* Webcam Control */}
                      <button
                        className={`btn ${isWebcamEnabled ? 'btn-danger' : 'btn-secondary'}`}
                        onClick={isWebcamEnabled ? stopWebcam : startWebcam}
                        disabled={isWebcamStarting}
                      >
                        {isWebcamStarting && (
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        )}
                        {isWebcamEnabled ? 'Stop Webcam' : 'Start Webcam'}
                      </button>

                      {/* Twitch Broadcast Control */}
                      <button
                        className={`btn ${isBroadcasting ? 'btn-danger' : 'btn-info'}`}
                        onClick={isBroadcasting ? stopTwitchBroadcast : startTwitchBroadcast}
                        disabled={!twitchStreamKey || gameLiftStatus !== StreamState.RUNNING || isBroadcastStarting || !isOffscreenCanvasSupported}
                        title={!isOffscreenCanvasSupported ? 'OffscreenCanvas not supported in this browser' : ''}
                      >
                        {isBroadcastStarting && (
                          <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                        )}
                        {isBroadcasting ? 'Stop Broadcast' : 'Broadcast to Twitch'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};
