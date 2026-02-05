/**
 * VolumeControl Component
 * Provides volume control for video/audio elements with mute toggle and volume slider
 * Positioned in bottom left of video containers
 */

import React, { useState, useEffect, useRef } from 'react';
import './VolumeControl.css';

interface VolumeControlProps {
  /** The video or audio element to control */
  mediaElement: HTMLVideoElement | HTMLAudioElement | null;
  /** Optional initial volume (0-1) */
  initialVolume?: number;
  /** Optional className for custom styling */
  className?: string;
  /** Optional callback when volume changes */
  onVolumeChange?: (volume: number, muted: boolean) => void;
}

export const VolumeControl: React.FC<VolumeControlProps> = ({
  mediaElement,
  initialVolume = 1,
  className = '',
  onVolumeChange
}) => {
  const [volume, setVolume] = useState(initialVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [showSlider, setShowSlider] = useState(false);
  const [previousVolume, setPreviousVolume] = useState(initialVolume);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);

  // Update media element volume when state changes
  useEffect(() => {
    if (mediaElement) {
      mediaElement.volume = isMuted ? 0 : volume;
      mediaElement.muted = isMuted;
      onVolumeChange?.(volume, isMuted);
    }
  }, [mediaElement, volume, isMuted, onVolumeChange]);

  // Sync with media element's initial state
  useEffect(() => {
    if (mediaElement) {
      setVolume(mediaElement.volume);
      setIsMuted(mediaElement.muted);
      setPreviousVolume(mediaElement.volume > 0 ? mediaElement.volume : 0.5);
    }
  }, [mediaElement]);

  // Handle click outside to hide slider
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (volumeControlRef.current && !volumeControlRef.current.contains(event.target as Node)) {
        setShowSlider(false);
      }
    };

    if (showSlider) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSlider]);

  const toggleMute = () => {
    if (isMuted) {
      // Unmute and restore previous volume
      setIsMuted(false);
      setVolume(previousVolume > 0 ? previousVolume : 0.5);
    } else {
      // Mute and remember current volume
      setPreviousVolume(volume);
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(event.target.value);
    setVolume(newVolume);
    
    // If volume is set to 0, consider it muted
    if (newVolume === 0) {
      setIsMuted(true);
    } else if (isMuted) {
      // If we're increasing volume from 0, unmute
      setIsMuted(false);
    }
  };

  const handleMouseEnter = () => {
    setShowSlider(true);
  };

  const handleMouseLeave = (event: React.MouseEvent) => {
    // Only hide if we're not moving to the slider
    const relatedTarget = event.relatedTarget;
    // Check if relatedTarget is a valid Node before using contains()
    const isValidNode = relatedTarget instanceof Node;
    if (!isValidNode || !volumeControlRef.current?.contains(relatedTarget)) {
      // Delay hiding to allow for mouse movement to slider
      setTimeout(() => {
        if (sliderRef.current && !sliderRef.current.matches(':hover')) {
          setShowSlider(false);
        }
      }, 100);
    }
  };

  const getVolumeIcon = () => {
    if (isMuted || volume === 0) {
      return 'bi-volume-mute-fill';
    } else if (volume < 0.3) {
      return 'bi-volume-down-fill';
    } else if (volume < 0.7) {
      return 'bi-volume-up-fill';
    } else {
      return 'bi-volume-up-fill';
    }
  };

  const getVolumePercentage = () => {
    return Math.round((isMuted ? 0 : volume) * 100);
  };

  return (
    <div 
      ref={volumeControlRef}
      className={`volume-control ${className} ${showSlider ? 'expanded' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid="volume-control"
    >
      {/* Volume Slider - appears above the button */}
      <div className={`volume-slider-container ${showSlider ? 'visible' : ''}`}>
        <div className="volume-percentage">{getVolumePercentage()}%</div>
        <input
          ref={sliderRef}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={isMuted ? 0 : volume}
          onChange={handleVolumeChange}
          className="volume-slider"
          aria-label="Volume"
        />
      </div>

      {/* Volume Button - always visible */}
      <button
        className={`volume-btn ${isMuted ? 'muted' : ''}`}
        onClick={toggleMute}
        title={isMuted ? 'Unmute' : 'Mute'}
        aria-label={isMuted ? 'Unmute' : 'Mute'}
      >
        <i className={`bi ${getVolumeIcon()}`}></i>
      </button>
    </div>
  );
};

export default VolumeControl;