import React from 'react';
import { StreamState } from './PlayerView';
import { ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST, GAMELIFT_STREAMS_CONFIG } from '../utils/constants';

interface SettingsModalProps {
  showModal: boolean;
  onClose: () => void;
  activeTab: 'general' | 'broadcast';
  setActiveTab: (tab: 'general' | 'broadcast') => void;
  
  // GameLift State
  gameLiftStatus: StreamState;
  selectedGame: string;
  sgId: string;
  appId: string;
  regions: string[];
  sessionId: string;
  lastSessionId: string;
  isStreamStarting: boolean;
  isDirectBroadcastStarting: boolean;
  isFullscreen: boolean;
  
  // Broadcast State
  isGameplayBroadcasting: boolean;
  isGameplayBroadcastStarting: boolean;
  isWebcamBroadcasting: boolean;
  isWebcamBroadcastStarting: boolean;
  demoMode: boolean;
  
  // Broadcast Config
  broadcastConfig: {
    encoderType: string;
    videoWidth: number;
    videoHeight: number;
    videoFramerate: number;
    videoBitrate: number;
    enableAudio: boolean;
    audioBitrate: number;
    debugPipeline: boolean;
  };
  
  // Event Handlers
  onGameSelectionChange: (gameName: string) => void;
  setSgId: (sgId: string) => void;
  setAppId: (appId: string) => void;
  setRegions: (regions: string[]) => void;
  setSessionId: (sessionId: string) => void;
  setDemoMode: (demoMode: boolean) => void;
  setBroadcastConfig: (config: any) => void;
  
  // Action Handlers
  onStartGame: () => void;
  onStopGame: () => void;
  onReconnect: () => void;
  onToggleFullscreen: () => void;
  onStartGameplayBroadcast: () => void;
  onStopGameplayBroadcast: () => void;
  onStartWebcamBroadcast: () => void;
  onStopWebcamBroadcast: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  showModal,
  onClose,
  activeTab,
  setActiveTab,
  gameLiftStatus,
  selectedGame,
  sgId,
  appId,
  regions,
  sessionId,
  lastSessionId,
  isStreamStarting,
  isDirectBroadcastStarting,
  isFullscreen,
  isGameplayBroadcasting,
  isGameplayBroadcastStarting,
  isWebcamBroadcasting,
  isWebcamBroadcastStarting,
  demoMode,
  broadcastConfig,
  onGameSelectionChange,
  setSgId,
  setAppId,
  setRegions,
  setSessionId,
  setDemoMode,
  setBroadcastConfig,
  onStartGame,
  onStopGame,
  onReconnect,
  onToggleFullscreen,
  onStartGameplayBroadcast,
  onStopGameplayBroadcast,
  onStartWebcamBroadcast,
  onStopWebcamBroadcast
}) => {
  if (!showModal) return null;

  return (
    <>
      <div className="modal-backdrop show"></div>
      <div className="modal show d-block" tabIndex={-1}>
        <div className="modal-dialog modal-lg">
          <div className="modal-content modal-content-custom">
            <div className="modal-header">
              <h5 className="modal-title">Player Settings</h5>
              <button
                type="button"
                className="btn-close"
                onClick={onClose}
              ></button>
            </div>

            {/* Tab Navigation */}
            <ul className="nav nav-tabs nav-tabs-custom">
              <li className="nav-item">
                <button
                  className={`nav-link nav-link-custom ${activeTab === 'general' ? 'active' : ''}`}
                  onClick={() => setActiveTab('general')}
                >
                  General
                </button>
              </li>
              {ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST && GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame]?.supportsDirectBroadcast && (
                <li className="nav-item">
                  <button
                    className={`nav-link nav-link-custom ${activeTab === 'broadcast' ? 'active' : ''}`}
                    onClick={() => setActiveTab('broadcast')}
                  >
                    Direct Broadcast Config
                  </button>
                </li>
              )}
            </ul>

            <div className="modal-body settings-modal-body">
              {/* General Tab */}
              {activeTab === 'general' && (
                <>
                  {/* GameLift Configuration */}
                  {/* <h6 className="mb-3">GameLift Stream Configuration</h6> */}
                  <div className="row g-3 mb-4">
                    <div className="col-md-12">
                      <label htmlFor="gameSelection" className="form-label">Game Selection</label>
                      <select
                        className="form-select"
                        id="gameSelection"
                        value={selectedGame}
                        onChange={(e) => onGameSelectionChange(e.target.value)}
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

                  {/* IVS Broadcast Status */}
                  {/* 
                  <h6 className="mb-3">Broadcast Status</h6>
                  <div className="row g-3 mb-4">
                    <div className="col-md-6">
                      <div className="card-custom">
                        <h6 className="card-title-custom">Gameplay Broadcast</h6>
                        <p className="card-text-custom">
                          Status: <strong>{isGameplayBroadcasting ? 'LIVE' : 'Offline'}</strong>
                        </p>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div className="card-custom">
                        <h6 className="card-title-custom">Webcam Broadcast</h6>
                        <p className="card-text-custom">
                          Status: <strong>{isWebcamBroadcasting ? 'LIVE' : 'Offline'}</strong>
                        </p>
                      </div>
                    </div>
                  </div> 
                  */}

                  {/* Demo Mode */}
                  {/* <h6 className="mb-3">Demo Mode</h6> */}
                  <div className="card-custom mb-3">
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <h6 className="card-title-custom mb-1">Auto Reactions & Chat</h6>
                        <p className="card-text-custom mb-0">
                          Automatically send random reactions and chat messages every 2.5 seconds
                        </p>
                      </div>
                      <div className="form-check form-switch form-switch-large">
                        <input
                          className="form-check-input form-check-input-custom"
                          type="checkbox"
                          role="switch"
                          id="demoModeSwitch"
                          checked={demoMode}
                          onChange={(e) => setDemoMode(e.target.checked)}
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Direct Broadcast Configuration Tab */}
              {activeTab === 'broadcast' && ENABLE_GAMELIFT_IVS_DIRECT_BROADCAST && GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame]?.supportsDirectBroadcast && (
                <>
                  <div className="alert alert-info alert-info-custom">
                    <i className="bi bi-info-circle me-1"></i>
                    These settings configure the video encoder on the GameLift instance for IVS broadcast.
                  </div>

                  {/* Encoder Options */}
                  {/* <h6 className="mb-3">Encoder Options</h6> */}
                  <div className="row g-3 mb-4">
                    <div className="col-md-4">
                      <label htmlFor="encoderType" className="form-label">Encoder Type</label>
                      <select
                        className="form-select"
                        id="encoderType"
                        value={broadcastConfig.encoderType}
                        onChange={(e) => setBroadcastConfig({...broadcastConfig, encoderType: e.target.value})}
                      >
                        <option value="gpu">GPU (NVIDIA)</option>
                        <option value="cpu">CPU (x264)</option>
                      </select>
                      <small className="form-text form-text-muted">
                        GPU encoding provides better performance
                      </small>
                    </div>
                    <div className="col-md-4">
                      <label htmlFor="audioBitrate" className="form-label">Audio Capture</label>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          role="switch"
                          id="enableAudio"
                          checked={broadcastConfig.enableAudio}
                          onChange={(e) => setBroadcastConfig({...broadcastConfig, enableAudio: e.target.checked})}
                          style={{ cursor: 'pointer' }}
                        />
                        <label className="form-check-label" htmlFor="enableAudio">
                          Enable Audio Capture
                        </label>
                      </div>
                    </div>
                    {broadcastConfig.enableAudio && (
                      <div className="col-md-4">
                        <label htmlFor="audioBitrate" className="form-label">Audio Bitrate (bps)</label>
                        <select
                          className="form-select"
                          id="audioBitrate"
                          value={broadcastConfig.audioBitrate}
                          onChange={(e) => setBroadcastConfig({...broadcastConfig, audioBitrate: parseInt(e.target.value)})}
                        >
                          <option value="64000">64 kbps</option>
                          <option value="128000">128 kbps</option>
                          <option value="192000">192 kbps</option>
                          <option value="256000">256 kbps</option>
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Video Options */}
                  {/* <h6 className="mb-3">Video Options</h6> */}
                  <div className="row g-3 mb-4">
                    <div className="col-md-3">
                      <label htmlFor="videoWidth" className="form-label">Video Width (pixels)</label>
                      <input
                        type="number"
                        className="form-control"
                        id="videoWidth"
                        value={broadcastConfig.videoWidth}
                        onChange={(e) => setBroadcastConfig({...broadcastConfig, videoWidth: parseInt(e.target.value) || 1280})}
                        min="640"
                        max="1920"
                      />
                    </div>
                    <div className="col-md-3">
                      <label htmlFor="videoHeight" className="form-label">Video Height (pixels)</label>
                      <input
                        type="number"
                        className="form-control"
                        id="videoHeight"
                        value={broadcastConfig.videoHeight}
                        onChange={(e) => setBroadcastConfig({...broadcastConfig, videoHeight: parseInt(e.target.value) || 720})}
                        min="480"
                        max="1080"
                      />
                    </div>
                    <div className="col-md-3">
                      <label htmlFor="videoFramerate" className="form-label">Framerate (fps)</label>
                      <select
                        className="form-select"
                        id="videoFramerate"
                        value={broadcastConfig.videoFramerate}
                        onChange={(e) => setBroadcastConfig({...broadcastConfig, videoFramerate: parseInt(e.target.value)})}
                      >
                        <option value="24">24 fps</option>
                        <option value="30">30 fps</option>
                        <option value="60">60 fps</option>
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label htmlFor="videoBitrate" className="form-label">Video Bitrate (kbps)</label>
                      <input
                        type="number"
                        className="form-control"
                        id="videoBitrate"
                        value={broadcastConfig.videoBitrate}
                        onChange={(e) => setBroadcastConfig({...broadcastConfig, videoBitrate: parseInt(e.target.value) || 4000})}
                        min="1000"
                        max="15000"
                        step="500"
                      />
                    </div>
                  </div>

                </>
              )}
            </div>
            <div className="modal-footer">
              <div className="d-flex flex-column gap-2 w-100">
                {/* First Row: GameLift Stream Controls */}
                <div className="d-flex gap-2 flex-wrap">
                  <button
                    className={`btn ${gameLiftStatus !== StreamState.RUNNING ? 'btn-success' : 'btn-danger'}`}
                    onClick={gameLiftStatus !== StreamState.RUNNING ? onStartGame : onStopGame}
                    disabled={isStreamStarting || isDirectBroadcastStarting}
                  >
                    {(isStreamStarting || isDirectBroadcastStarting) && (
                      <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    )}
                    {gameLiftStatus !== StreamState.RUNNING ? 'Start Game' : 'Stop Game'}
                  </button>

                  {(sessionId || lastSessionId) && (
                    <button
                      className="btn btn-warning"
                      onClick={onReconnect}
                      disabled={isStreamStarting}
                    >
                      Reconnect
                    </button>
                  )}

                  <button
                    className="btn btn-primary"
                    onClick={onToggleFullscreen}
                    disabled={gameLiftStatus !== StreamState.RUNNING}
                  >
                    {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                  </button>

                  <button
                    className={`btn ${isGameplayBroadcasting ? 'btn-danger' : 'btn-info'}`}
                    onClick={isGameplayBroadcasting ? onStopGameplayBroadcast : onStartGameplayBroadcast}
                    disabled={isGameplayBroadcastStarting || gameLiftStatus !== StreamState.RUNNING || GAMELIFT_STREAMS_CONFIG.gameLibrary[selectedGame]?.supportsDirectBroadcast}
                  >
                    {isGameplayBroadcastStarting && (
                      <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    )}
                    {isGameplayBroadcasting ? 'Stop Broadcast' : 'Start Broadcast'}
                  </button>

                  <button
                    className={`btn ${isWebcamBroadcasting ? 'btn-danger' : 'btn-info'}`}
                    onClick={isWebcamBroadcasting ? onStopWebcamBroadcast : onStartWebcamBroadcast}
                    disabled={isWebcamBroadcastStarting}
                  >
                    {isWebcamBroadcastStarting && (
                      <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                    )}
                    {isWebcamBroadcasting ? 'Stop Webcam' : 'Start Webcam'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};