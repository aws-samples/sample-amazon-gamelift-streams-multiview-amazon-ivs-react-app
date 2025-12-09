// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React from 'react';
import './StreamComponent.css';

interface NavBarProps {
    user: any;
    signOut: () => void;
}

const NavBar: React.FC<NavBarProps> = ({ user, signOut }) => {
    return (
        <nav className="navbar" style={{
            backgroundColor: '#101419',
            height: '110px',
            padding: '0 20px'
        }}>
            <div className="container-fluid d-flex align-items-center justify-content-between">
                {/* Empty div for left spacing */}
                <div className="flex-fill" />
                
                {/* Center content with title and logo */}
                <div className="d-flex align-items-center">
                    <span className="navbar-brand text-white mb-0 me-3" style={{
                        fontSize: 'clamp(16px, 2.5vw, 36px)',
                        fontWeight: '500'
                    }}>
                        Amazon GameLift Streams
                    </span>
                    <div className="logo" />
                </div>
                
                {/* Sign out button container */}
                <div className="flex-fill d-flex justify-content-end">
                    {user && (
                        <button 
                            className="btn btn-outline-light"
                            onClick={signOut}
                        >
                            Sign Out
                        </button>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default NavBar;
