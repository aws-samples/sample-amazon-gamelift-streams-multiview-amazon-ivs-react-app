/**
 * IVS-related TypeScript Type Definitions
 */

import {
  Stage,
  LocalStageStream,
  StageStream,
  StageConnectionState
} from 'amazon-ivs-web-broadcast';

// IVS Participant Token Request
export interface TokenRequest {
  stageArn: string;
  capabilities: ('PUBLISH' | 'SUBSCRIBE')[];
  attributes: {
    username: string;
    stream_source?: 'gameplay' | 'player_webcam';
  };
}

// IVS Participant Token Response
export interface TokenResponse {
  token: string;
  participantId: string;
  expirationTime: string;
  attributes: Record<string, string>;
  capabilities: string[];
  duration: number;
}

// IVS Stage Configuration
export interface IVSStageConfig {
  participantToken: string;
  streams?: LocalStageStream[];
  onConnectionStateChange?: (state: StageConnectionState) => void;
  onStreamsAdded?: (streams: any[]) => void; // Using any[] to avoid type conflicts with SDK versions
  onParticipantLeft?: (participantInfo: any) => void;
  onError?: (error: Error) => void;
}

// Re-export IVS SDK types for convenience
export type { Stage, LocalStageStream, StageStream, StageConnectionState };
export type RemoteStageStream = StageStream;
