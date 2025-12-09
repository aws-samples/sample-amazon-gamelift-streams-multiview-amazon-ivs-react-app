/**
 * User-related TypeScript Type Definitions
 */

import { Stage, LocalStageStream, RemoteStageStream } from 'amazon-ivs-web-broadcast';

// User Role Type
export type UserRole = 'player' | 'viewer';

// Stream State for GameLift
export enum StreamState {
  IDLE = 'IDLE',
  STARTING = 'STARTING',
  ACTIVE = 'ACTIVE',
  STOPPING = 'STOPPING',
  ERROR = 'ERROR'
}

// Player View State
export interface PlayerViewState {
  // GameLift Stream
  gameLiftStatus: StreamState;
  sgId: string;
  appId: string;
  sessionId: string;
  regions: string[];
  inputEnabled: boolean;
  isStreamStarting: boolean;

  // IVS Gameplay Broadcast
  gameplayStage: Stage | null;
  isGameplayBroadcasting: boolean;
  isGameplayBroadcastStarting: boolean;

  // IVS Webcam Broadcast
  webcamStage: Stage | null;
  webcamStream: MediaStream | null;
  isWebcamBroadcasting: boolean;
  isWebcamBroadcastStarting: boolean;

  // UI
  showSettingsModal: boolean;
  username: string;
  errors: string[];
}

// Viewer View State
export interface ViewerViewState {
  stage: Stage | null;
  gameplayStream: RemoteStageStream | null;
  webcamStream: RemoteStageStream | null;
  isConnecting: boolean;
  isConnected: boolean;
  username: string;
  errors: string[];
}
