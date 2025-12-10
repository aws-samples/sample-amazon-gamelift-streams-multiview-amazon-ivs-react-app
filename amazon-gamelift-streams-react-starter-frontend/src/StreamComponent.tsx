// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import './StreamComponent.css';
import * as gameliftstreamssdk from './gamelift-streams-websdk/gameliftstreams-1.0.0';
import { ApiError, get, post } from 'aws-amplify/api';
import { fetchAuthSession } from 'aws-amplify/auth';
import NavBar from './NavBar';
import { VolumeControl } from './components/VolumeControl';
import { 
    Stage, 
    LocalStageStream, 
    SubscribeType, 
    StageEvents, 
    ConnectionState
} from 'amazon-ivs-web-broadcast';
import { IVS_CONFIG, GAMELIFT_STREAMS_CONFIG } from './utils/constants';

// Extend HTMLVideoElement and HTMLAudioElement to include captureStream method
declare global {
    interface HTMLVideoElement {
        captureStream(frameRate?: number): MediaStream;
    }
    interface HTMLAudioElement {
        captureStream(): MediaStream;
    }
}

interface StreamComponentProps {
    signOut: any;
    user: any;
}

export enum StreamState {
    STOPPED = 1,
    LOADING,
    RUNNING,
    ERROR
}

interface StreamComponentState {
    status: StreamState;
    sgId: string;
    appId: string;
    sessionId: string;
    lastSessionId: string;
    regions: string[];
    inputEnabled: boolean;
    isStreamStarting: boolean;
    isBroadcasting: boolean;
    isBroadcastStarting: boolean;
    broadcastError: string | null;
    showSettingsModal: boolean;
}

class StreamComponent extends React.Component<StreamComponentProps, StreamComponentState> {
    gameliftstreams?: gameliftstreamssdk.GameLiftStreams;
    ivsStage?: Stage;
    videoRef = React.createRef<HTMLVideoElement>();
    audioRef = React.createRef<HTMLAudioElement>();

    constructor(props: StreamComponentProps) {
        super(props);

        this.state = {
            status: StreamState.STOPPED,
            sgId: GAMELIFT_STREAMS_CONFIG.streamGroupId,
            appId: GAMELIFT_STREAMS_CONFIG.applicationId,
            sessionId: '',
            lastSessionId: '',
            regions: [GAMELIFT_STREAMS_CONFIG.defaultRegion], // Must be supported Amazon GameLift Streams primary region (https://docs.aws.amazon.com/gameliftstreams/latest/developerguide/regions-quotas-rande.html)
            inputEnabled: false,
            isStreamStarting: false,
            isBroadcasting: false,
            isBroadcastStarting: false,
            broadcastError: null,
            showSettingsModal: true // Open by default when page loads
        };

        this.createStreamSession = this.createStreamSession.bind(this);
        this.createStreamSessionConnection = this.createStreamSessionConnection.bind(this);
        this.closeConnection = this.closeConnection.bind(this);
        this.handleInputChange = this.handleInputChange.bind(this);
        this.handleRegionChange = this.handleRegionChange.bind(this);
        this.enableFullScreen = this.enableFullScreen.bind(this);
        this.attachInput = this.attachInput.bind(this);
        this.startIVSBroadcast = this.startIVSBroadcast.bind(this);
        this.stopIVSBroadcast = this.stopIVSBroadcast.bind(this);
        this.toggleSettingsModal = this.toggleSettingsModal.bind(this);
    }

    componentDidMount(): void {
        this.resetGameLiftStreamsSDK();
    }

    private resetGameLiftStreamsSDK() {
        this.gameliftstreams = new gameliftstreamssdk.GameLiftStreams({
            videoElement: this.videoRef.current || this.getVideoElement(),
            audioElement: this.audioRef.current || this.getAudioElement(),
            inputConfiguration: {
                setCursor: 'visibility',
                autoPointerLock: 'fullscreen'
            },
            clientConnection: {
                /*
                // Connection callback handlers available if needed
                connectionState: this.streamConnectionStateCallback,
                channelError: this.streamChannelErrorCallback,
                serverDisconnect: this.streamServerDisconnectCallback
                */
            }
        });
    }

    private getVideoElement(): HTMLVideoElement {
        return document.getElementById(`StreamVideoElement`) as HTMLVideoElement;
    }

    private getAudioElement(): HTMLAudioElement {
        return document.getElementById(`StreamAudioElement`) as HTMLAudioElement;
    }

    /**
     * Sets the state for any kind of error - unwraps if error is of type ApiError.
     */
    private handleError(e: any) {
        console.log(e);
        if (e instanceof ApiError) {
            if (e.response) {
                const { statusCode, body } = e.response;
                const data = JSON.parse(body ?? '');
                this.setState({ isStreamStarting: false });
                console.error(`Received ${statusCode} error response with payload: ${body}`);
                alert(`Error: ${statusCode} - ${data.message || 'Unknown error'}. Check console for details.`);
            }
        } else {
            this.setState({ isStreamStarting: false });
            alert(`Error: ${e.message || 'Unknown error'}. Check console for details.`);
        }
    }

    /**
     * Sets timeout error in state.
     */
    private handleTimeout(arn: string) {
        const message = `Timeout in waiting for Stream Session: ${arn}`;
        console.error(`Polling timed out, ` + message);
        alert('Error: Stream session creation timed out. Check console for details.');
    }

    /**
     * Creates a new stream session using StartStream Lambda and then waits for it to be ready using @waitForACTIVE
     */
    private async createStreamSession() {
        this.setState({ isStreamStarting: true });
        
        // Immediately trigger fullscreen on the container div while we have the user gesture context
        const containerElement = document.getElementById('StreamContainer');
        if (containerElement) {
            try {
                await containerElement.requestFullscreen();
                
                // Use Keyboard API to set a "long hold" escape from fullscreen
                // if the browser supports this API (note that Safari does not)
                // @ts-ignore
                if (navigator.keyboard) {
                    // @ts-ignore
                    const keyboard = navigator.keyboard;
                    keyboard.lock(["Escape"]).catch(() => {
                        // Silently handle keyboard lock failures
                    });
                }
            } catch (error) {
                console.warn('Fullscreen request failed:', error);
                // Continue with stream creation even if fullscreen fails
            }
        }
        
        const signalRequest = await this.gameliftstreams?.generateSignalRequest();
        const payload = {
            AppIdentifier: this.state.appId,
            SGIdentifier: this.state.sgId,
            SignalRequest: signalRequest ?? '',
            Regions: this.state.regions
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
            await this.waitForACTIVE(data.arn, this.state.sgId);
        } catch (e) {
            this.handleError(e);
        }
    }

    /**
     * Creates a new stream session using StartStream Lambda and then waits for it to be ready using @waitForACTIVE
     */
    private async createStreamSessionConnection() {
        this.setState({ isStreamStarting: true });
        const signalRequest = await this.gameliftstreams?.generateSignalRequest();
        const payload = {
            SessionIdentifier: this.state.sessionId,
            SignalRequest: signalRequest ?? '',
        };
        console.log(payload);

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
            await this.startStream(data.signalResponse);
        } catch (e) {
            this.handleError(e);
        }
    }

    /**
     * Waits for a stream session to be ready, polling a new stream sessions every second until its ready or times out.
     * This is more effective than having a Lambda function waiting for the session and potentially timing out.
     * This also allows for OnDemand scaling to work if a new session takes 30+ seconds to be ready.
     */
    async waitForACTIVE(arn: string, sg: string, timeoutMs: number = 600000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) { // while not timedout
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

                if (data.status === 'ACTIVE') { // the session is ACTIVE and we can connect
                    await this.startStream(data.signalResponse);
                    this.setState((prevState) => ({
                        ...prevState,
                        lastSessionId: arn
                    }));
                    return; // session is started, state is set for it so we can return
                }
                // else we wait for 1s and loop again
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
                this.handleError(e);
                this.setState({ isStreamStarting: false });
                return;
            }
        }
        // timed out
        this.handleTimeout(arn);
        this.setState({ isStreamStarting: false });
    }

    private async startStream(signalResponse: any) {
        console.log('start stream')
        await this.gameliftstreams?.processSignalResponse(signalResponse);
        // Don't automatically attach input - wait for user to click
        this.setState((prevState) => ({
            ...prevState,
            status: StreamState.RUNNING,
            isStreamStarting: false,
            inputEnabled: false // Keep false until user clicks to attach input
        }));
    }

    /**
     * Closes the connection and creates a new Amazon GameLift Streams Object as it can't be reused.
     */
    private closeConnection() {
        // Stop IVS broadcast if active
        if (this.state.isBroadcasting) {
            this.stopIVSBroadcast();
        }

        this.setState({status: StreamState.STOPPED, inputEnabled: false});
        this.gameliftstreams?.close();
        this.resetGameLiftStreamsSDK();
        this.setState({ isStreamStarting: false });

        if (document.fullscreenElement) {
            document.exitFullscreen().then();
        }
    }

    private enableFullScreen() {
        const containerElement = document.getElementById('StreamContainer');
        if (containerElement) {
            // If input is not already enabled, attach it when going fullscreen
            if (!this.state.inputEnabled) {
                this.attachInput();
            }
            
            // Try to request fullscreen on the container div
            containerElement.requestFullscreen().catch((error) => {
                console.warn('Fullscreen request failed:', error);
                // Silently fail if fullscreen can't be activated automatically
                // User can still click the fullscreen button manually
            });
            
            // Use Keyboard API to set a "long hold" escape from fullscreen
            // if the browser supports this API (note that Safari does not)
            // @ts-ignore
            if (navigator.keyboard) {
                // @ts-ignore
                const keyboard = navigator.keyboard;
                keyboard.lock(["Escape"]).catch(() => {
                    // Silently handle keyboard lock failures
                });
            }
        }
    }

    private attachInput() {
        this.gameliftstreams?.attachInput();
        this.setState({ inputEnabled: true });
    }

    private handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
        const { name, value } = event.target; // Extract name and value from input
        this.setState((prevState) => ({ ...prevState, [name]: value.trim() })); // Dynamically update state
    }

    private handleRegionChange(event: React.ChangeEvent<HTMLSelectElement>) {
        const region = event.target.value;
        this.setState((prevState) => ({
            ...prevState,
            regions: [region] // Update the regions array with the selected region
        }));
    }

    private toggleSettingsModal() {
        this.setState((prevState) => ({
            showSettingsModal: !prevState.showSettingsModal
        }));
    }

    /**
     * Gets a participant token for the IVS stage
     */
    private async getIVSStageToken(): Promise<string> {
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
                        username: 'ivs-rtx-unity-gamelift',
                        capabilities: ['PUBLISH'],
                        attributes: {
                            username: 'ivs-rtx-unity-gamelift'
                        }
                    }
                }
            });

            const { body } = await restOperation.response;
            const data = JSON.parse(await body.text());
            return data.token; // Extract the token field from the response
        } catch (error) {
            throw new Error(`Failed to get stage token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Starts broadcasting the GameLift stream to IVS Real-time
     */
    private async startIVSBroadcast() {
        if (!this.videoRef.current || this.state.status !== StreamState.RUNNING) {
            alert('GameLift stream must be running before starting IVS broadcast');
            return;
        }

        this.setState({ isBroadcastStarting: true, broadcastError: null });

        try {
            // Get participant token
            const participantToken = await this.getIVSStageToken();

            // Capture stream from the video element
            const videoElement = this.videoRef.current;
            const audioElement = this.audioRef.current;

            // Create media stream from video element
            let mediaStream: MediaStream;
            
            if (videoElement.captureStream) {
                // Capture both video and audio from the video element
                mediaStream = videoElement.captureStream();
            } else {
                throw new Error('captureStream is not supported in this browser');
            }

            // If audio element exists and has audio tracks, add them to the stream
            if (audioElement && audioElement.captureStream) {
                const audioStream = audioElement.captureStream();
                const audioTracks = audioStream.getAudioTracks();
                audioTracks.forEach(track => {
                    mediaStream.addTrack(track);
                });
            }

            // Create LocalStageStream instances for video and audio tracks
            const videoTracks = mediaStream.getVideoTracks();
            const audioTracks = mediaStream.getAudioTracks();
            
            const stageStreams: LocalStageStream[] = [];
            
            if (videoTracks.length > 0) {
                stageStreams.push(new LocalStageStream(videoTracks[0]));
            }
            
            if (audioTracks.length > 0) {
                stageStreams.push(new LocalStageStream(audioTracks[0]));
            }

            // Define the stage strategy
            const strategy = {
                stageStreamsToPublish() {
                    return stageStreams;
                },
                shouldPublishParticipant() {
                    return true;
                },
                shouldSubscribeToParticipant() {
                    return SubscribeType.NONE; // We don't need to subscribe to others
                }
            };

            // Create and configure the stage
            this.ivsStage = new Stage(participantToken, strategy);

            // Set up event listeners
            this.ivsStage.on(StageEvents.STAGE_CONNECTION_STATE_CHANGED, (state: any) => {
                console.log('IVS Stage connection state changed:', state);
                if (state === ConnectionState.CONNECTED) {
                    console.log('Successfully connected to IVS stage');
                    this.setState({ 
                        isBroadcasting: true, 
                        isBroadcastStarting: false 
                    });
                }
            });

            this.ivsStage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (participant: any) => {
                console.log('Participant joined:', participant);
            });

            this.ivsStage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (participant: any) => {
                console.log('Participant left:', participant);
            });

            // Join the stage
            await this.ivsStage.join();

            console.log('Successfully started IVS broadcast');

        } catch (error) {
            console.error('Failed to start IVS broadcast:', error);
            this.setState({ 
                broadcastError: error instanceof Error ? error.message : 'Unknown error',
                isBroadcastStarting: false 
            });
            alert(`Failed to start IVS broadcast: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Stops the IVS broadcast
     */
    private async stopIVSBroadcast() {
        if (!this.ivsStage) {
            return;
        }

        try {
            await this.ivsStage.leave();
            this.ivsStage = undefined;
            this.setState({ 
                isBroadcasting: false, 
                broadcastError: null 
            });
            console.log('Successfully stopped IVS broadcast');
        } catch (error) {
            console.error('Failed to stop IVS broadcast:', error);
            alert(`Failed to stop IVS broadcast: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    render() {
        return (
            <>
                <style>
                    {`
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                        @keyframes pulse {
                            0% { opacity: 1; }
                            50% { opacity: 0.5; }
                            100% { opacity: 1; }
                        }
                    `}
                </style>
                
                {/* NavBar - Title and Sign Out */}
                <NavBar user={this.props.user} signOut={this.props.signOut} />

                {/* Settings Button */}
                <div className="container-fluid mt-2">
                    <div className="row justify-content-center">
                        <div className="col-8">
                            <div className="d-flex justify-content-end mb-2">
                                <button
                                    className="btn btn-outline-secondary btn-sm"
                                    onClick={this.toggleSettingsModal}
                                >
                                    <i className="bi bi-gear"></i> Settings
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* IVS Broadcast Status */}
                {this.state.isBroadcasting && (
                    <div className="container-fluid">
                        <div className="row justify-content-center">
                            <div className="col-8">
                                <div className="alert alert-success d-flex align-items-center" role="alert">
                                    <div className="me-2" style={{
                                        width: '10px',
                                        height: '10px',
                                        backgroundColor: '#dc3545',
                                        borderRadius: '50%',
                                        animation: 'pulse 1.5s infinite'
                                    }}></div>
                                    <strong>LIVE:</strong>&nbsp;Broadcasting to Amazon IVS Real-time Stage
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Amazon GameLift Streams Video Element */}
                <div className="container-fluid mt-2">
                    <div className="row justify-content-center">
                        <div className="col-8">
                            <div 
                                id="StreamContainer"
                                className="ratio ratio-16x9 rounded shadow-sm" 
                                style={{ position: 'relative', backgroundColor: '#000' }}
                            >
                                <video
                                    ref={this.videoRef}
                                    id={'StreamVideoElement'}
                                    autoPlay 
                                    playsInline 
                                    className="rounded"
                                    style={{
                                        backgroundColor: '#000',
                                        width: '100%',
                                        height: '100%'
                                    }}
                                />
                                {/* Loading overlay - shows while stream is starting */}
                                {this.state.isStreamStarting && (
                                    <div 
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            right: 0,
                                            bottom: 0,
                                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontSize: '1.2rem',
                                            zIndex: 10
                                        }}
                                    >
                                        <div 
                                            style={{
                                                width: '40px',
                                                height: '40px',
                                                border: '4px solid rgba(255, 255, 255, 0.3)',
                                                borderTop: '4px solid white',
                                                borderRadius: '50%',
                                                animation: 'spin 1s linear infinite',
                                                marginBottom: '1rem'
                                            }}
                                        />
                                        <div>Starting GameLift Stream Session...</div>
                                        <div style={{ fontSize: '0.9rem', marginTop: '0.5rem', opacity: 0.8 }}>
                                            This may take up to 30 seconds
                                        </div>
                                    </div>
                                )}

                                {/* Attach Input overlay - shows when stream is running but input not attached */}
                                {this.state.status === StreamState.RUNNING && !this.state.inputEnabled && (
                                    <div 
                                        onClick={this.attachInput}
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            right: 0,
                                            bottom: 0,
                                            backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontSize: '1.2rem',
                                            zIndex: 10,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {/* IVS Broadcast Button - styled like attach input button */}
                                        <div 
                                            onClick={(e) => {
                                                e.stopPropagation(); // Prevent triggering attach input
                                                this.state.isBroadcasting ? this.stopIVSBroadcast() : this.startIVSBroadcast();
                                            }}
                                            style={{
                                                padding: '1rem 2rem',
                                                border: `2px solid ${this.state.isBroadcasting ? '#dc3545' : '#0dcaf0'}`,
                                                borderRadius: '8px',
                                                backgroundColor: this.state.isBroadcasting ? 'rgba(220, 53, 69, 0.1)' : 'rgba(13, 202, 240, 0.1)',
                                                transition: 'all 0.2s ease',
                                                marginBottom: '1rem',
                                                cursor: 'pointer'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = this.state.isBroadcasting ? 'rgba(220, 53, 69, 0.2)' : 'rgba(13, 202, 240, 0.2)';
                                                e.currentTarget.style.transform = 'scale(1.05)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = this.state.isBroadcasting ? 'rgba(220, 53, 69, 0.1)' : 'rgba(13, 202, 240, 0.1)';
                                                e.currentTarget.style.transform = 'scale(1)';
                                            }}
                                        >
                                            {this.state.isBroadcastStarting && (
                                                <span style={{ marginRight: '0.5rem' }}>⟳</span>
                                            )}
                                            {this.state.isBroadcasting ? 'Stop IVS Broadcast' : 'Start IVS Broadcast'}
                                        </div>

                                        <div 
                                            style={{
                                                padding: '1rem 2rem',
                                                border: '2px solid white',
                                                borderRadius: '8px',
                                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                                transition: 'all 0.2s ease',
                                                marginBottom: '1rem'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                                                e.currentTarget.style.transform = 'scale(1.05)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                                                e.currentTarget.style.transform = 'scale(1)';
                                            }}
                                        >
                                            Click to Attach Input
                                        </div>
                                        <div style={{ fontSize: '0.9rem', opacity: 0.8, textAlign: 'center' }}>
                                            Click anywhere on the video to enable mouse and keyboard input
                                        </div>
                                    </div>
                                )}

                                {/* Volume Control for GameLift Stream */}
                                {this.state.status === StreamState.RUNNING && (
                                    <VolumeControl
                                        mediaElement={this.audioRef.current}
                                        initialVolume={1}
                                        className="stream-volume-control"
                                    />
                                )}
                            </div>
                            <audio ref={this.audioRef} id={'StreamAudioElement'} autoPlay></audio>
                        </div>
                    </div>
                </div>

                {/* Settings Modal */}
                {this.state.showSettingsModal && (
                    <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                        <div className="modal-dialog modal-lg">
                            <div className="modal-content">
                                <div className="modal-header">
                                    <h5 className="modal-title">GameLift Streams Settings</h5>
                                    <button 
                                        type="button" 
                                        className="btn-close" 
                                        onClick={this.toggleSettingsModal}
                                    ></button>
                                </div>
                                <div className="modal-body">
                                    <div className="row g-3">
                                        <div className="col-md-6">
                                            <label htmlFor="sgId" className="form-label">Stream Group ID</label>
                                            <input 
                                                type="text" 
                                                className="form-control" 
                                                id="sgId"
                                                name="sgId" 
                                                value={this.state.sgId}
                                                onChange={this.handleInputChange}
                                                placeholder="sg-xxxxxxx"
                                            />
                                        </div>
                                        <div className="col-md-6">
                                            <label htmlFor="appId" className="form-label">Application ID</label>
                                            <input 
                                                type="text" 
                                                className="form-control" 
                                                id="appId"
                                                name="appId" 
                                                value={this.state.appId}
                                                onChange={this.handleInputChange}
                                                placeholder="a-xxxxxxx"
                                            />
                                        </div>
                                        <div className="col-md-6">
                                            <label htmlFor="region" className="form-label">Region</label>
                                            <select 
                                                className="form-select" 
                                                id="region"
                                                onChange={this.handleRegionChange} 
                                                value={this.state.regions[0]}
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
                                                name="sessionId" 
                                                value={this.state.sessionId || this.state.lastSessionId}
                                                onChange={this.handleInputChange}
                                                placeholder="Session ID"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <div className="d-flex justify-content-between w-100">
                                        <div className="d-flex gap-2">
                                            <button
                                                className={`btn ${this.state.status !== StreamState.RUNNING ? 'btn-success' : 'btn-danger'}`}
                                                onClick={this.state.status !== StreamState.RUNNING ? this.createStreamSession : this.closeConnection}
                                                disabled={this.state.isStreamStarting}
                                            >
                                                {this.state.isStreamStarting && (
                                                    <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                                )}
                                                {this.state.status !== StreamState.RUNNING ? 'Start GameLift Stream' : 'Stop GameLift Stream'}
                                            </button>
                                            
                                            {this.state.sessionId && (
                                                <button
                                                    className="btn btn-warning"
                                                    onClick={this.createStreamSessionConnection}
                                                    disabled={this.state.isStreamStarting}
                                                >
                                                    Reconnect
                                                </button>
                                            )}
                                        </div>
                                        
                                        <div className="d-flex gap-2">
                                            {this.state.status === StreamState.RUNNING && (
                                                <>
                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={this.enableFullScreen}
                                                    >
                                                        Fullscreen
                                                    </button>
                                                    
                                                    <button
                                                        className={`btn ${this.state.isBroadcasting ? 'btn-danger' : 'btn-info'}`}
                                                        onClick={this.state.isBroadcasting ? this.stopIVSBroadcast : this.startIVSBroadcast}
                                                        disabled={this.state.isBroadcastStarting}
                                                    >
                                                        {this.state.isBroadcastStarting && (
                                                            <span className="spinner-border spinner-border-sm me-2" role="status"></span>
                                                        )}
                                                        {this.state.isBroadcasting ? 'Stop IVS Broadcast' : 'Start IVS Broadcast'}
                                                    </button>
                                                </>
                                            )}
                                            
                                            <button 
                                                type="button" 
                                                className="btn btn-secondary" 
                                                onClick={this.toggleSettingsModal}
                                            >
                                                Close
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </>
        );
    }
}

export default StreamComponent;
