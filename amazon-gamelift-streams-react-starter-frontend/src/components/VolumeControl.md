# VolumeControl Component

A reusable React component that provides volume control functionality for HTML video and audio elements. The component features a compact single-element design that expands vertically on hover, similar to modern media players.

## Features

-   **Compact Design**: Single speaker icon that expands on hover
-   **Vertical Expansion**: Smooth animation reveals volume slider above the speaker
-   **Mute/Unmute Toggle**: Click the speaker icon to toggle mute
-   **Visual Feedback**: Different volume icons based on current volume level
-   **Volume Percentage Display**: Shows current volume as a percentage
-   **Glassmorphism Design**: Modern translucent background with blur effects
-   **Responsive Design**: Adapts to different screen sizes
-   **Accessibility**: Full keyboard and screen reader support
-   **Cross-browser Compatibility**: Works with all modern browsers

## Usage

```tsx
import { VolumeControl } from './VolumeControl';

// Basic usage
<VolumeControl
  mediaElement={videoRef.current}
  initialVolume={1}
/>

// With callback
<VolumeControl
  mediaElement={audioRef.current}
  initialVolume={0.5}
  className="custom-volume-control"
  onVolumeChange={(volume, muted) => {
    console.log(`Volume: ${volume}, Muted: ${muted}`);
  }}
/>
```

## Props

| Prop             | Type                                           | Default | Description                  |
| ---------------- | ---------------------------------------------- | ------- | ---------------------------- |
| `mediaElement`   | `HTMLVideoElement \| HTMLAudioElement \| null` | -       | The media element to control |
| `initialVolume`  | `number`                                       | `1`     | Initial volume level (0-1)   |
| `className`      | `string`                                       | `''`    | Additional CSS class name    |
| `onVolumeChange` | `(volume: number, muted: boolean) => void`     | -       | Callback when volume changes |

## Styling

The component uses CSS custom properties and can be styled using the following classes:

-   `.volume-control` - Main container
-   `.volume-btn` - Volume button
-   `.volume-slider-container` - Slider container
-   `.volume-slider` - Volume slider input
-   `.volume-percentage` - Percentage display

## Integration

The VolumeControl component has been integrated into:

1. **PlayerView** - Controls for GameLift audio and webcam video
2. **ViewerView** - Controls for gameplay and webcam streams
3. **InteractivePlayTestView** - Controls for gameplay and webcam streams
4. **StreamComponent** - Controls for legacy GameLift stream

## Positioning

The component is positioned absolutely in the bottom left corner of its parent container using:

```css
position: absolute;
bottom: 12px;
left: 12px;
```

## Accessibility

-   Full keyboard navigation support
-   Screen reader compatible with ARIA labels
-   High contrast mode support
-   Reduced motion support for users with motion sensitivity

## Browser Support

-   Chrome/Edge 88+
-   Firefox 85+
-   Safari 14+
-   All modern mobile browsers
