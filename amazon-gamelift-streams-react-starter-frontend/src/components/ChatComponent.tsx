/**
 * ChatComponent - Reusable chat UI component
 * Integrates with AppSyncChatClient for real-time messaging
 */

import React, { useState, useEffect, useRef } from 'react';
import { AppSyncChatClient } from '../utils/AppSyncChatClient';
import { ChatMessage } from '../types/chat.types';
import './ChatComponent.css';

interface ChatComponentProps {
  username: string;
  chatClient: AppSyncChatClient;
  hideHeader?: boolean;
  removeRoundedCorners?: boolean;
  isSidebarCollapsed?: boolean;
  isPlayer?: boolean;
  invitedViewer?: string | null;
  onInviteViewer?: (viewerUsername: string) => void;
}

interface FloatingEmote {
  id: string;
  icon: string;
  left: number;
}

export const ChatComponent: React.FC<ChatComponentProps> = ({ 
  username, 
  chatClient, 
  hideHeader = false, 
  removeRoundedCorners = false, 
  isSidebarCollapsed = false,
  isPlayer = false,
  invitedViewer = null,
  onInviteViewer
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [queuedMessageCount, setQueuedMessageCount] = useState(0);
  const [showEmoteOverlay, setShowEmoteOverlay] = useState(false);
  const [floatingEmotes, setFloatingEmotes] = useState<FloatingEmote[]>([]);
  const [hoveredMessageUser, setHoveredMessageUser] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);

  // Debug: Log when showEmoteOverlay changes
  useEffect(() => {
    console.log('showEmoteOverlay changed to:', showEmoteOverlay);
  }, [showEmoteOverlay]);

  // Set up chat client handlers on mount
  useEffect(() => {
    // Message handler
    const handleMessage = (message: ChatMessage) => {
      setMessages((prevMessages) => [...prevMessages, message]);
    };

    // Connection state handler
    const handleConnectionState = (connected: boolean) => {
      setIsConnected(connected);
      if (!connected) {
        setIsReconnecting(true);
      } else {
        setIsReconnecting(false);
      }
    };

    chatClient.onMessage(handleMessage);
    chatClient.onConnectionStateChange(handleConnectionState);

    // Initialize connection
    const initializeChat = async () => {
      try {
        await chatClient.connect();
        await chatClient.subscribe();
      } catch (error) {
        console.error('Failed to initialize chat:', error);
      }
    };

    initializeChat();

    // Poll for queued message count
    const queueCheckInterval = setInterval(() => {
      const count = chatClient.getQueuedMessageCount();
      setQueuedMessageCount(count);
    }, 1000);

    // Cleanup on unmount
    return () => {
      clearInterval(queueCheckInterval);
      chatClient.disconnect();
    };
  }, [chatClient]);

  // Auto-scroll functionality - don't scroll when sidebar is collapsed
  useEffect(() => {
    if (!userHasScrolledUp && !isSidebarCollapsed && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, userHasScrolledUp, isSidebarCollapsed]);

  // Detect if user has scrolled up
  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setUserHasScrolledUp(!isAtBottom);
    }
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  };

  // Handle message sending
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim() || isSending) {
      return;
    }

    setIsSending(true);

    try {
      await chatClient.publish(inputValue.trim(), username);
      setInputValue('');
    } catch (error) {
      console.error('Failed to send message:', error);
      // Message is queued by the client, so we can still clear the input
      setInputValue('');
    } finally {
      setIsSending(false);
    }
  };

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  // Handle Enter key press
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e as any);
    }
  };

  // Get icon class for reaction type
  const getReactionIcon = (reaction: string): string => {
    const iconMap: Record<string, string> = {
      like: 'bi-heart-fill',
      fire: 'bi-fire',
      star: 'bi-star-fill',
      laugh: 'bi-emoji-laughing-fill',
      clap: 'bi-hand-thumbs-up-fill',
      wow: 'bi-emoji-surprise-fill'
    };
    return iconMap[reaction] || 'bi-heart-fill';
  };

  // Trigger floating emote animation
  const triggerFloatingEmote = (reaction: string) => {
    const newEmote: FloatingEmote = {
      id: `${Date.now()}-${Math.random()}`,
      icon: getReactionIcon(reaction),
      left: Math.random() * 80 + 10 // Random position between 10% and 90%
    };

    setFloatingEmotes(prev => [...prev, newEmote]);

    // Remove emote after animation completes (3 seconds)
    setTimeout(() => {
      setFloatingEmotes(prev => prev.filter(e => e.id !== newEmote.id));
    }, 3000);
  };

  // Handle inviting a viewer to join the stage
  const handleInviteViewer = (viewerUsername: string) => {
    if (onInviteViewer && viewerUsername !== username) {
      onInviteViewer(viewerUsername);
    }
  };

  // Check if a user can be invited (not the player, not already invited)
  const canInviteUser = (messageUser: string): boolean => {
    return isPlayer && messageUser !== username && invitedViewer === null;
  };

  // Handle sending reactions
  const handleSendReaction = async (reaction: string) => {
    try {
      // Create the reaction event with the exact structure requested
      const reactionEvent = {
        action: 'STREAM_REACT',
        reaction: reaction,
        message: null,
        user: null,
        timestamp: Date.now()
      };

      // Use the publishRaw method to send the reaction event
      await (chatClient as any).publishRaw(reactionEvent);
      
      console.log('Sent reaction:', reaction);
      
      // Trigger floating emote animation
      triggerFloatingEmote(reaction);
      
      // Close emote overlay after sending
      setShowEmoteOverlay(false);
    } catch (error) {
      console.error('Failed to send reaction:', error);
    }
  };

  return (
    <div className={`chat-component ${removeRoundedCorners ? 'no-rounded-corners' : ''}`}>
      {/* Connection status indicator */}
      {!hideHeader && (
        <div className="chat-header">
          <h3>Chat</h3>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isReconnecting ? (
              <>
                <span className="status-indicator reconnecting"></span>
                <span className="status-text">Reconnecting...</span>
              </>
            ) : isConnected ? (
              <>
                <span className="status-indicator"></span>
                <span className="status-text">Connected</span>
              </>
            ) : (
              <>
                <span className="status-indicator"></span>
                <span className="status-text">Disconnected</span>
            </>
          )}
        </div>
        </div>
      )}

      {/* Queued messages indicator */}
      {queuedMessageCount > 0 && (
        <div className="queued-messages-banner">
          {queuedMessageCount} message{queuedMessageCount !== 1 ? 's' : ''} queued - will send when reconnected
        </div>
      )}

      {/* Message list */}
      <div
        className="messages-container"
        ref={messagesContainerRef}
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <div className="no-messages">No messages yet. Start the conversation!</div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={`${msg.timestamp}-${index}`}
              className={`message ${msg.user === username ? 'own-message' : ''}`}
              onMouseEnter={() => setHoveredMessageUser(msg.user)}
              onMouseLeave={() => setHoveredMessageUser(null)}
            >
              <div className="message-header">
                <div className="message-user-container">
                  <span className="message-username">{msg.user}</span>
                  {/* Invite button - shown on hover for players when hovering over other users' messages */}
                  {isPlayer && 
                   hoveredMessageUser === msg.user && 
                   canInviteUser(msg.user) && (
                    <button
                      className="invite-viewer-btn"
                      onClick={() => handleInviteViewer(msg.user)}
                      title={`Invite ${msg.user} to join your stream`}
                      aria-label={`Invite ${msg.user} to join your stream`}
                    >
                      <i className="bi bi-person-plus-fill"></i>
                    </button>
                  )}
                  {/* Show invited badge if this user is the invited viewer */}
                  {invitedViewer === msg.user && (
                    <span className="invited-badge" title="Invited to stream">
                      <i className="bi bi-broadcast"></i>
                    </span>
                  )}
                </div>
                <span className="message-timestamp">{formatTimestamp(msg.timestamp)}</span>
              </div>
              <div className="message-text">{msg.message}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message input */}
      <form className="message-input-form" onSubmit={handleSendMessage}>
        <div className="input-group">
          <button
            type="button"
            className="btn-emote"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('Emoji button clicked, current state:', showEmoteOverlay);
              setShowEmoteOverlay(!showEmoteOverlay);
            }}
            disabled={!isConnected}
            title="Reactions"
          >
            <i className="bi bi-emoji-smile"></i>
          </button>
          <input
            type="text"
            className="message-input"
            placeholder="Type a message..."
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={!isConnected || isSending}
          />
          <button
            type="submit"
            className="btn-send"
            disabled={!isConnected || !inputValue.trim() || isSending}
            title="Send message"
          >
            {isSending ? (
              <i className="bi bi-hourglass-split"></i>
            ) : (
              <i className="bi bi-send-fill"></i>
            )}
          </button>
        </div>
      </form>

      {/* Floating Emotes */}
      {floatingEmotes.map(emote => (
        <div
          key={emote.id}
          className="floating-emote"
          style={{ left: `${emote.left}%` }}
        >
          <i className={`bi ${emote.icon}`}></i>
        </div>
      ))}

      {/* Emote Overlay */}
      {showEmoteOverlay && (
        <div className="emote-overlay">
          <div className="emote-overlay-header">
            <h4>Reactions</h4>
            <button
              className="btn-close-overlay"
              onClick={() => setShowEmoteOverlay(false)}
            >
              <i className="bi bi-x-lg"></i>
            </button>
          </div>
          <div className="emote-grid">
            <button
              className="emote-button"
              onClick={() => handleSendReaction('like')}
              title="Like"
            >
              <i className="bi bi-heart-fill"></i>
              <span>Like</span>
            </button>
            <button
              className="emote-button"
              onClick={() => handleSendReaction('fire')}
              title="Fire"
            >
              <i className="bi bi-fire"></i>
              <span>Fire</span>
            </button>
            <button
              className="emote-button"
              onClick={() => handleSendReaction('star')}
              title="Star"
            >
              <i className="bi bi-star-fill"></i>
              <span>Star</span>
            </button>
            <button
              className="emote-button"
              onClick={() => handleSendReaction('laugh')}
              title="Laugh"
            >
              <i className="bi bi-emoji-laughing-fill"></i>
              <span>Laugh</span>
            </button>
            <button
              className="emote-button"
              onClick={() => handleSendReaction('clap')}
              title="Clap"
            >
              <i className="bi bi-hand-thumbs-up-fill"></i>
              <span>Clap</span>
            </button>
            <button
              className="emote-button"
              onClick={() => handleSendReaction('wow')}
              title="Wow"
            >
              <i className="bi bi-emoji-surprise-fill"></i>
              <span>Wow</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
