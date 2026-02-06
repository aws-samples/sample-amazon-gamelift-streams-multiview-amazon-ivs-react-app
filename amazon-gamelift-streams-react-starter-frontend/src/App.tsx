import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { PlayerView } from './components/PlayerView';
import ViewerView from './components/ViewerView';
import { TwitchBroadcastView } from './components/TwitchBroadcastView';
import { InteractivePlayTestView } from './components/InteractivePlayTestView';
import { UserRole } from './types/user.types';
import { COGNITO_CONFIG, API_CONFIG } from './utils/constants';
import { fetchRuntimeConfig } from './utils/configService';
import '@aws-amplify/ui-react/styles.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';

Amplify.configure({
    Auth: {
        Cognito: {
            userPoolId: COGNITO_CONFIG.userPoolId,
            userPoolClientId: COGNITO_CONFIG.userPoolClientId
        }
    },
    API: {
        REST: {
            'demo-api': {
                endpoint: API_CONFIG.endpoint
            }
        }
    }
});

/**
 * Determines user role based on email address
 * @param email - User's email address
 * @returns UserRole - 'player' or 'viewer'
 */
function determineUserRole(email: string): UserRole {
    const normalizedEmail = email.toLowerCase().trim();
    
    // Check for player email
    if (normalizedEmail === 'player@ivs.rocks') {
        return 'player';
    }
    
    // Check for viewer email
    if (normalizedEmail === 'viewer@ivs.rocks') {
        return 'viewer';
    }
    
    // Default to viewer for unknown emails
    return 'viewer';
}

/**
 * Main content component that handles role-based routing
 */
interface MainContentProps {
    signOut?: () => void;
    user: any;
}

const MainContent: React.FC<MainContentProps> = ({ signOut, user }) => {
    const [userRole, setUserRole] = useState<UserRole | null>(null);
    const [configLoaded, setConfigLoaded] = useState(false);
    const [configError, setConfigError] = useState<string | null>(null);

    useEffect(() => {
        if (user?.signInDetails?.loginId) {
            const role = determineUserRole(user.signInDetails.loginId);
            setUserRole(role);
        }
    }, [user]);

    // Fetch runtime config (sensitive values from SSM) after authentication
    useEffect(() => {
        fetchRuntimeConfig()
            .then(() => setConfigLoaded(true))
            .catch((err) => {
                console.error('Failed to load runtime config:', err);
                setConfigError(err.message);
            });
    }, []);

    // Show loading state while determining role or loading config
    if (!userRole || !configLoaded) {
        if (configError) {
            return <div style={{ padding: '2rem', color: '#ff6b6b' }}>Failed to load configuration: {configError}</div>;
        }
        return <div>Loading...</div>;
    }

    const isPlayer = userRole === 'player';

    return (
        <Router>
            <Routes>
                {/* Interactive Play Test route - accessible to all users */}
                <Route 
                    path="/interactive-playtest" 
                    element={<InteractivePlayTestView signOut={signOut || (() => {})} user={user} />} 
                />
                
                {/* Twitch Broadcast route - only accessible to player@ivs.rocks */}
                <Route 
                    path="/twitch-broadcast" 
                    element={
                        isPlayer ? (
                            <TwitchBroadcastView signOut={signOut} user={user} />
                        ) : (
                            <Navigate to="/" replace />
                        )
                    } 
                />
                
                {/* Default route - role-based view */}
                <Route 
                    path="/" 
                    element={
                        isPlayer ? (
                            <PlayerView signOut={signOut} user={user} />
                        ) : (
                            <ViewerView signOut={signOut} user={user} />
                        )
                    } 
                />
            </Routes>
        </Router>
    );
};

function App() {
    return (
        <Authenticator hideSignUp={true} loginMechanisms={['email']}>
            {({ signOut, user }) => (
                <MainContent signOut={signOut} user={user} />
            )}
        </Authenticator>
    );
}

export default App;
