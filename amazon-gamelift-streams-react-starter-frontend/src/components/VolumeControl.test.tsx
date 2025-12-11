/**
 * VolumeControl Component Tests
 * Tests for the volume control functionality
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VolumeControl } from './VolumeControl';

// Mock HTMLMediaElement methods
const mockPlay = jest.fn();
const mockPause = jest.fn();

// Create a mock video element
const createMockVideoElement = (initialVolume = 1, initialMuted = false) => {
  const mockElement = {
    volume: initialVolume,
    muted: initialMuted,
    play: mockPlay,
    pause: mockPause,
  } as unknown as HTMLVideoElement;
  return mockElement;
};

describe('VolumeControl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders volume control button', () => {
    const mockVideo = createMockVideoElement();
    render(<VolumeControl mediaElement={mockVideo} />);
    
    const volumeButton = screen.getByRole('button', { name: /mute/i });
    expect(volumeButton).toBeInTheDocument();
  });

  it('shows correct volume icon for different volume levels', () => {
    const mockVideo = createMockVideoElement(0.8);
    render(<VolumeControl mediaElement={mockVideo} />);
    
    const volumeButton = screen.getByRole('button', { name: /mute/i });
    expect(volumeButton.innerHTML).toContain('bi-volume-up-fill');
  });

  it('shows mute icon when volume is 0', () => {
    const mockVideo = createMockVideoElement(0, false);
    render(<VolumeControl mediaElement={mockVideo} initialVolume={0} />);
    
    const volumeButton = screen.getByRole('button', { name: /mute/i });
    expect(volumeButton.innerHTML).toContain('bi-volume-mute-fill');
  });

  it('toggles mute when button is clicked', async () => {
    const mockVideo = createMockVideoElement();
    const onVolumeChange = jest.fn();
    
    render(
      <VolumeControl 
        mediaElement={mockVideo} 
        onVolumeChange={onVolumeChange}
      />
    );
    
    const volumeButton = screen.getByRole('button', { name: /mute/i });
    fireEvent.click(volumeButton);
    
    await waitFor(() => expect(mockVideo.muted).toBe(true));
    expect(onVolumeChange).toHaveBeenCalledWith(expect.any(Number), true);
  });

  it('shows volume slider on hover', async () => {
    const mockVideo = createMockVideoElement();
    render(<VolumeControl mediaElement={mockVideo} />);
    
    const volumeControl = screen.getByTestId('volume-control');
    
    fireEvent.mouseEnter(volumeControl);
    
    await waitFor(() => {
      const slider = screen.getByRole('slider', { name: /volume/i });
      expect(slider).toBeInTheDocument();
    });
  });

  it('updates volume when slider changes', async () => {
    const mockVideo = createMockVideoElement();
    const onVolumeChange = jest.fn();
    
    render(
      <VolumeControl 
        mediaElement={mockVideo} 
        onVolumeChange={onVolumeChange}
      />
    );
    
    // Show slider
    const volumeControl = screen.getByTestId('volume-control');
    fireEvent.mouseEnter(volumeControl);
    
    const slider = await screen.findByRole('slider', { name: /volume/i });
    fireEvent.change(slider, { target: { value: '0.5' } });
    
    await waitFor(() => expect(mockVideo.volume).toBe(0.5));
    expect(onVolumeChange).toHaveBeenCalledWith(0.5, false);
  });

  it('handles null media element gracefully', () => {
    expect(() => {
      render(<VolumeControl mediaElement={null} />);
    }).not.toThrow();
  });

  it('applies custom className', () => {
    const mockVideo = createMockVideoElement();
    render(<VolumeControl mediaElement={mockVideo} className="custom-class" />);
    
    const volumeControl = screen.getByTestId('volume-control');
    expect(volumeControl).toHaveClass('custom-class');
  });

  it('displays correct volume percentage', async () => {
    const mockVideo = createMockVideoElement(0.75);
    render(<VolumeControl mediaElement={mockVideo} initialVolume={0.75} />);
    
    // Show slider
    const volumeControl = screen.getByTestId('volume-control');
    fireEvent.mouseEnter(volumeControl);
    
    await waitFor(() => {
      expect(screen.getByText('75%')).toBeInTheDocument();
    });
  });

  it('unmutes when volume is increased from 0', async () => {
    const mockVideo = createMockVideoElement(0, false);
    const onVolumeChange = jest.fn();
    
    render(
      <VolumeControl 
        mediaElement={mockVideo} 
        initialVolume={0}
        onVolumeChange={onVolumeChange}
      />
    );
    
    // Show slider
    const volumeControl = screen.getByTestId('volume-control');
    fireEvent.mouseEnter(volumeControl);
    
    const slider = await screen.findByRole('slider', { name: /volume/i });
    fireEvent.change(slider, { target: { value: '0.5' } });
    
    await waitFor(() => expect(mockVideo.muted).toBe(false));
    expect(mockVideo.volume).toBe(0.5);
    expect(onVolumeChange).toHaveBeenCalledWith(0.5, false);
  });
});