/**
 * Chat-related TypeScript Type Definitions
 */

// Chat Message Structure
export interface ChatMessage {
  action: 'USER_CHAT_MESSAGE';
  message: string;
  user: string;
  timestamp: number;
}

// Control Message Types
export interface BaseControlMessage {
  action: string;
  timestamp: number;
}

export interface TakeoverRequestMessage extends BaseControlMessage {
  action: 'TAKEOVER_REQUEST';
  requesterUsername: string;
}

export interface TakeoverApprovedMessage extends BaseControlMessage {
  action: 'TAKEOVER_APPROVED';
  sessionId: string;
}

export interface TakeoverDeniedMessage extends BaseControlMessage {
  action: 'TAKEOVER_DENIED';
}

export interface TakeoverCancelledMessage extends BaseControlMessage {
  action: 'TAKEOVER_CANCELLED';
}

// Viewer Invite Control Messages
export interface ViewerInviteMessage extends BaseControlMessage {
  action: 'VIEWER_INVITE';
  inviterUsername: string;
  invitedUsername: string;
}

export interface ViewerInviteAcceptedMessage extends BaseControlMessage {
  action: 'VIEWER_INVITE_ACCEPTED';
  invitedUsername: string;
}

export interface ViewerInviteDeclinedMessage extends BaseControlMessage {
  action: 'VIEWER_INVITE_DECLINED';
  invitedUsername: string;
}

export interface ViewerInviteCancelledMessage extends BaseControlMessage {
  action: 'VIEWER_INVITE_CANCELLED';
  inviterUsername: string;
}

export interface ViewerLeftStageMessage extends BaseControlMessage {
  action: 'VIEWER_LEFT_STAGE';
  viewerUsername: string;
}

export type ControlMessage =
  | TakeoverRequestMessage
  | TakeoverApprovedMessage
  | TakeoverDeniedMessage
  | TakeoverCancelledMessage
  | ViewerInviteMessage
  | ViewerInviteAcceptedMessage
  | ViewerInviteDeclinedMessage
  | ViewerInviteCancelledMessage
  | ViewerLeftStageMessage;

export type ControlMessageHandler = (message: ControlMessage) => void;

// Type Guards for Control Messages
export function isTakeoverRequestMessage(message: any): message is TakeoverRequestMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'TAKEOVER_REQUEST' &&
    typeof message.requesterUsername === 'string' &&
    typeof message.timestamp === 'number'
  );
}

export function isTakeoverApprovedMessage(message: any): message is TakeoverApprovedMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'TAKEOVER_APPROVED' &&
    typeof message.sessionId === 'string' &&
    typeof message.timestamp === 'number'
  );
}

export function isTakeoverDeniedMessage(message: any): message is TakeoverDeniedMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'TAKEOVER_DENIED' &&
    typeof message.timestamp === 'number'
  );
}

export function isTakeoverCancelledMessage(message: any): message is TakeoverCancelledMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'TAKEOVER_CANCELLED' &&
    typeof message.timestamp === 'number'
  );
}

// Type Guards for Viewer Invite Messages
export function isViewerInviteMessage(message: any): message is ViewerInviteMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'VIEWER_INVITE' &&
    typeof message.inviterUsername === 'string' &&
    typeof message.invitedUsername === 'string' &&
    typeof message.timestamp === 'number'
  );
}

export function isViewerInviteAcceptedMessage(message: any): message is ViewerInviteAcceptedMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'VIEWER_INVITE_ACCEPTED' &&
    typeof message.invitedUsername === 'string' &&
    typeof message.timestamp === 'number'
  );
}

export function isViewerInviteDeclinedMessage(message: any): message is ViewerInviteDeclinedMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'VIEWER_INVITE_DECLINED' &&
    typeof message.invitedUsername === 'string' &&
    typeof message.timestamp === 'number'
  );
}

export function isViewerInviteCancelledMessage(message: any): message is ViewerInviteCancelledMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'VIEWER_INVITE_CANCELLED' &&
    typeof message.inviterUsername === 'string' &&
    typeof message.timestamp === 'number'
  );
}

export function isViewerLeftStageMessage(message: any): message is ViewerLeftStageMessage {
  return (
    message &&
    typeof message === 'object' &&
    message.action === 'VIEWER_LEFT_STAGE' &&
    typeof message.viewerUsername === 'string' &&
    typeof message.timestamp === 'number'
  );
}

export function isControlMessage(message: any): message is ControlMessage {
  return (
    isTakeoverRequestMessage(message) ||
    isTakeoverApprovedMessage(message) ||
    isTakeoverDeniedMessage(message) ||
    isTakeoverCancelledMessage(message) ||
    isViewerInviteMessage(message) ||
    isViewerInviteAcceptedMessage(message) ||
    isViewerInviteDeclinedMessage(message) ||
    isViewerInviteCancelledMessage(message) ||
    isViewerLeftStageMessage(message)
  );
}

// AppSync Event API Configuration
export interface AppSyncConfig {
  apiKey: string;
  httpEndpoint: string;
  realtimeEndpoint: string;
  channelName: string;
}

// WebSocket Message Types
export interface ConnectionInitMessage {
  type: 'connection_init';
}

export interface ConnectionAckMessage {
  type: 'connection_ack';
  connectionTimeoutMs: number;
}

export interface SubscribeMessage {
  id: string;
  type: 'subscribe';
  channel: string;
}

export interface SubscribeSuccessMessage {
  id: string;
  type: 'subscribe_success';
}

export interface PublishMessage {
  id: string;
  type: 'publish';
  channel: string;
  events: ChatMessage[];
}

export interface PublishSuccessMessage {
  id: string;
  type: 'publish_success';
}

export interface SubscriptionEventMessage {
  id: string;
  type: 'data';
  event: ChatMessage;
}

export interface KeepAliveMessage {
  type: 'ka';
}

export interface ErrorMessage {
  id?: string;
  type: 'error';
  errors?: Array<{
    message: string;
    errorType?: string;
  }>;
}

export type AppSyncWebSocketMessage =
  | ConnectionInitMessage
  | ConnectionAckMessage
  | SubscribeMessage
  | SubscribeSuccessMessage
  | PublishMessage
  | PublishSuccessMessage
  | SubscriptionEventMessage
  | KeepAliveMessage
  | ErrorMessage;
