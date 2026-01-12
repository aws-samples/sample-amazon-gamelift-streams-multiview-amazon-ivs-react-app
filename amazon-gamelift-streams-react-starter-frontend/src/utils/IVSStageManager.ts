/**
 * IVS Stage Manager Utility
 * Manages IVS Real-time Stage lifecycle including creation, joining, leaving, and stream management
 */

import {
  Stage,
  LocalStageStream,
  StageEvents,
  SubscribeType,
  StageConnectionState,
  StageParticipantInfo,
  StageStream
} from 'amazon-ivs-web-broadcast';
import { IVSStageConfig, TokenResponse } from '../types/ivs.types';
import { IVS_CONFIG } from './constants';
import { post } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * IVSStageManager class encapsulates IVS Stage creation and management logic
 */
export class IVSStageManager {
  private stage: Stage | null = null;
  private config: IVSStageConfig | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectTimeoutId: NodeJS.Timeout | null = null;
  private isReconnecting: boolean = false;

  /**
   * Fetches a participant token from the IVS token API
   * Implements subtask 3.3: Add participant token fetching
   * Implements subtask 8.1: Catch and display token fetch errors
   * 
   * @param username - Unique username for the participant
   * @param capabilities - Array of capabilities (PUBLISH or SUBSCRIBE)
   * @param streamSource - Optional stream source attribute (gameplay, player_webcam, or participant_webcam)
   * @param supportsCouchCoop - Optional boolean indicating if the game supports couch co-op
   * @returns Promise resolving to the participant token string
   * @throws Error if token fetch fails with user-friendly message
   */
  async fetchParticipantToken(
    username: string,
    capabilities: ('PUBLISH' | 'SUBSCRIBE')[],
    streamSource?: 'gameplay' | 'player_webcam' | 'participant_webcam',
    supportsCouchCoop?: boolean
  ): Promise<string> {
    try {
      const restOperation = post({
        apiName: 'demo-api',
        path: '/get-stage-token',
        options: {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${(await fetchAuthSession()).tokens?.idToken?.toString()}`
          },
          body: {
            stageArn: IVS_CONFIG.stageArn,
            capabilities,
            attributes: {
              username,
              ...(streamSource && { stream_source: streamSource }),
              ...(supportsCouchCoop !== undefined && { supports_couch_coop: supportsCouchCoop.toString() })
            }
          }
        }
      });

      const { body } = await restOperation.response;
      const tokenResponse: TokenResponse = JSON.parse(await body.text());

      if (!tokenResponse.token) {
        throw new Error('Invalid token response from server. Please try again.');
      }

      return tokenResponse.token;
    } catch (error) {
      if (error instanceof Error) {
        // Re-throw errors with our custom messages
        throw error;
      } else if (error instanceof TypeError && error.message.includes('fetch')) {
        // Network error
        throw new Error('Network connection failed. Please check your internet connection and try again.');
      } else {
        throw new Error('Unable to connect to streaming service. Please check your connection and try again.');
      }
    }
  }

  /**
   * Creates an IVS Stage instance with strategy configuration
   * Implements subtask 3.1: Implement stage creation and strategy
   * Implements subtask 8.1: Catch and display stage connection errors
   * 
   * @param config - Stage configuration including token, streams, and event handlers
   * @returns Promise resolving to the created Stage instance
   * @throws Error if stage creation fails with user-friendly message
   */
  async createStage(config: IVSStageConfig): Promise<Stage> {
    try {
      this.config = config;

      // Create Stage instance with participant token
      const stage = new Stage(config.participantToken, {
        // Define strategy for publishing streams
        stageStreamsToPublish: () => {
          return config.streams || [];
        },

        // Define strategy for determining if participant should publish
        shouldPublishParticipant: () => {
          // Publish if we have streams configured
          return (config.streams && config.streams.length > 0) || false;
        },

        // Define strategy for subscribing to remote participants
        shouldSubscribeToParticipant: () => {
          // Subscribe to all participants (for viewer role)
          return SubscribeType.AUDIO_VIDEO;
        }
      });

      // Configure stage event listeners
      this.setupEventListeners(stage, config);

      this.stage = stage;
      return stage;
    } catch (error) {
      if (error instanceof Error) {
        // Check for specific error types
        if (error.message.includes('token')) {
          throw new Error('Invalid streaming token. Please refresh and try again.');
        } else if (error.message.includes('permission')) {
          throw new Error('Permission denied. Please check your streaming permissions.');
        } else {
          throw new Error(`Unable to initialize streaming: ${error.message}`);
        }
      } else {
        throw new Error('Unable to initialize streaming. Please try again.');
      }
    }
  }

  /**
   * Sets up event listeners for the stage
   * Part of subtask 3.1: Configure stage event listeners
   * Implements subtask 8.1: Handle stage connection errors and implement reconnection
   * 
   * @param stage - The Stage instance to attach listeners to
   * @param config - Configuration containing event handler callbacks
   */
  private setupEventListeners(stage: Stage, config: IVSStageConfig): void {
    // Listen for connection state changes
    if (config.onConnectionStateChange) {
      stage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: StageConnectionState) => {
        console.log('Stage connection state changed:', state);

        // Reset reconnect attempts on successful connection
        if (state === StageConnectionState.CONNECTED) {
          this.reconnectAttempts = 0;
          this.isReconnecting = false;
          if (this.reconnectTimeoutId) {
            clearTimeout(this.reconnectTimeoutId);
            this.reconnectTimeoutId = null;
          }
        }

        // Handle disconnection
        if (state === StageConnectionState.DISCONNECTED && !this.isReconnecting) {
          console.warn('Stage disconnected unexpectedly');
          this.attemptReconnect(config);
        }

        config.onConnectionStateChange!(state as any);
      });
    }

    // Listen for remote participant streams being added
    if (config.onStreamsAdded) {
      stage.on(
        StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED,
        (participant: StageParticipantInfo, streams: StageStream[]) => {
          console.log('Participant streams added:', {
            userId: participant.userId,
            attributes: participant.attributes,
            isLocal: participant.isLocal,
            streamCount: streams.length
          });

          // Store participant info with streams for later identification
          streams.forEach((stream: any) => {
            // Attach participant info to stream for identification
            stream._participantInfo = participant;
            // Also attach isLocal flag directly to stream for easy access
            stream._isLocal = participant.isLocal;
          });

          config.onStreamsAdded!(streams as any);
        }
      );
    }

    // Listen for participant leaving
    stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: StageParticipantInfo) => {
      console.log('Participant left:', participant);
      if (config.onParticipantLeft) {
        config.onParticipantLeft(participant);
      }
    });

    // Listen for general errors
    stage.on(StageEvents.ERROR, (error: any) => {
      console.log('=== StageEvents.ERROR triggered ===');
      console.error('Stage error event:', error);
      console.log('Error code:', error.code);
      console.log('Error category:', error.category);
      console.log('Error message:', error.message);

      if (config.onError) {
        config.onError(error);
      }
    });

    // Listen for publish state changes (to catch publication failures)
    stage.on(StageEvents.STAGE_PARTICIPANT_PUBLISH_STATE_CHANGED, (participant: StageParticipantInfo, state: any) => {
      console.log('Publish state changed:', {
        userId: participant.userId,
        isLocal: participant.isLocal,
        state
      });

      // Check if this is the local participant and if publish errored
      if (participant.isLocal && state === 'ERRORED') {
        console.warn('Local participant publish state is ERRORED');
        // This will be accompanied by a StageEvents.ERROR event with more details
      }
    });
  }

  /**
   * Creates LocalStageStream instances from MediaStreamTracks
   * Implements subtask 3.2: Implement stream management
   * 
   * @param mediaStream - MediaStream containing video and/or audio tracks
   * @returns Array of LocalStageStream instances
   */
  createLocalStreams(mediaStream: MediaStream): LocalStageStream[] {
    const streams: LocalStageStream[] = [];

    // Create LocalStageStream for each video track
    const videoTracks = mediaStream.getVideoTracks();
    videoTracks.forEach((track) => {
      const videoStream = new LocalStageStream(track);
      streams.push(videoStream);
    });

    // Create LocalStageStream for each audio track
    const audioTracks = mediaStream.getAudioTracks();
    audioTracks.forEach((track) => {
      const audioStream = new LocalStageStream(track);
      streams.push(audioStream);
    });

    return streams;
  }

  /**
   * Updates the streams being published to the stage
   * Part of subtask 3.2: Handle stream addition and removal
   * 
   * @param streams - New array of LocalStageStream instances to publish
   * @throws Error if stage is not initialized
   */
  updateStreams(streams: LocalStageStream[]): void {
    if (!this.stage) {
      throw new Error('Stage not initialized. Call createStage first.');
    }

    if (this.config) {
      this.config.streams = streams;
    }

    // Refresh the stage to apply new stream configuration
    this.stage.refreshStrategy();
  }

  /**
   * Joins the IVS stage
   * Implements subtask 8.1: Catch and display stage connection errors
   * 
   * @throws Error if stage is not initialized or join fails with user-friendly message
   */
  async joinStage(): Promise<void> {
    if (!this.stage) {
      throw new Error('Streaming not initialized. Please try again.');
    }

    try {
      await this.stage.join();
    } catch (error) {
      console.log('------------');
      console.log(error);
      if (error instanceof Error) {
        // Provide user-friendly error messages
        if (error.message.includes('token')) {
          throw new Error('Streaming token expired. Please refresh and try again.');
        } else if (error.message.includes('network') || error.message.includes('connection')) {
          throw new Error('Network connection failed. Please check your internet and try again.');
        } else if (error.message.includes('permission')) {
          throw new Error('Camera or microphone permission denied. Please allow access and try again.');
        } else if (error.message.includes('limit') || error.message.includes('capacity') || error.message.includes('Stage at capacity')) {
          // Preserve the original error for capacity issues so it can be caught specifically
          const capacityError = new Error('Stage at capacity. Maximum 12 participants allowed.');
          capacityError.name = 'StageClientError';
          throw capacityError;
        } else {
          throw new Error(`Unable to connect to stream: ${error.message}`);
        }
      } else {
        throw new Error('Unable to connect to stream. Please try again.');
      }
    }
  }

  /**
   * Leaves the IVS stage and performs cleanup
   * Part of subtask 3.2: Manage stream state and cleanup
   * 
   * @throws Error if leave operation fails
   */
  async leaveStage(): Promise<void> {
    // Cancel any pending reconnection attempts
    this.cancelReconnect();

    if (!this.stage) {
      return; // Already left or never joined
    }

    try {
      await this.stage.leave();

      // Clean up local streams
      if (this.config?.streams) {
        this.config.streams.forEach((stream) => {
          const track = stream.mediaStreamTrack;
          if (track) {
            track.stop();
          }
        });
      }

      this.stage = null;
      this.config = null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Error leaving stage:', errorMessage);
      // Don't throw error on cleanup - just log it
      // Still clean up local state
      this.stage = null;
      this.config = null;
    }
  }

  /**
   * Gets the current Stage instance
   * 
   * @returns The Stage instance or null if not initialized
   */
  getStage(): Stage | null {
    return this.stage;
  }

  /**
   * Checks if the stage is currently active
   * 
   * @returns True if stage exists and is joined
   */
  isActive(): boolean {
    return this.stage !== null;
  }

  /**
   * Attempts to reconnect to the stage with exponential backoff
   * Implements subtask 8.1: Implement reconnection with exponential backoff
   * 
   * @param config - Original stage configuration for reconnection
   */
  private attemptReconnect(config: IVSStageConfig): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      if (config.onError) {
        config.onError(new Error('Unable to reconnect to stream after multiple attempts. Please refresh the page.'));
      }
      return;
    }

    if (this.isReconnecting) {
      return; // Already attempting to reconnect
    }

    this.isReconnecting = true;

    // Clear any existing reconnect timeout
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
    }

    // Calculate backoff delay: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);
    this.reconnectAttempts++;

    console.log(`Attempting reconnection in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeoutId = setTimeout(async () => {
      try {
        if (this.stage) {
          console.log('Attempting to rejoin stage...');
          await this.stage.join();
          console.log('Successfully reconnected to stage');
          this.isReconnecting = false;
        }
      } catch (error) {
        console.error('Reconnection attempt failed:', error);
        this.isReconnecting = false;
        // Try again with next backoff
        this.attemptReconnect(config);
      }
    }, delay);
  }

  /**
   * Cancels any pending reconnection attempts
   */
  cancelReconnect(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
  }
}
