/**
 * Authentication context provider.
 * Handles auth state across all deployment modes.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Deploy mode from environment
const DEPLOY_MODE = import.meta.env.VITE_DEPLOY_MODE || 'local';

export interface User {
    id: string;
    email?: string;
    name?: string;
    picture?: string;
    plan: 'free' | 'pro' | 'unlimited';
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    accessToken: string | null;
    login: () => void;
    logout: () => void;
    refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Token storage keys
const TOKEN_KEY = 'fraktag_access_token';
const REFRESH_TOKEN_KEY = 'fraktag_refresh_token';
const USER_KEY = 'fraktag_user';

// Cognito configuration from environment
const COGNITO_DOMAIN = import.meta.env.VITE_COGNITO_DOMAIN;
const COGNITO_CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID;
const COGNITO_REDIRECT_URI = import.meta.env.VITE_COGNITO_REDIRECT_URI || `${window.location.origin}/auth/callback`;

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Initialize auth state
    useEffect(() => {
        initializeAuth();
    }, []);

    async function initializeAuth() {
        // Local mode: Always authenticated as admin
        if (DEPLOY_MODE === 'local') {
            setUser({
                id: 'local-admin',
                email: 'admin@local',
                name: 'Local Admin',
                plan: 'unlimited',
            });
            setIsLoading(false);
            return;
        }

        // Enterprise mode: Check for enterprise headers or passthrough
        if (DEPLOY_MODE === 'enterprise') {
            // Could integrate with SSO here
            setUser({
                id: 'enterprise-user',
                plan: 'unlimited',
            });
            setIsLoading(false);
            return;
        }

        // Cloud mode: Check for existing tokens
        const storedToken = localStorage.getItem(TOKEN_KEY);
        const storedUser = localStorage.getItem(USER_KEY);

        if (storedToken && storedUser) {
            try {
                // Validate token is not expired
                const payload = JSON.parse(atob(storedToken.split('.')[1]));
                if (payload.exp * 1000 > Date.now()) {
                    setAccessToken(storedToken);
                    setUser(JSON.parse(storedUser));
                } else {
                    // Token expired, try refresh
                    await refreshToken();
                }
            } catch (e) {
                // Invalid token, clear storage
                clearAuth();
            }
        }

        // Check for OAuth callback
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        if (code) {
            await handleOAuthCallback(code);
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        setIsLoading(false);
    }

    async function handleOAuthCallback(code: string) {
        if (!COGNITO_DOMAIN || !COGNITO_CLIENT_ID) {
            console.error('Cognito not configured');
            return;
        }

        try {
            // Exchange code for tokens
            const tokenEndpoint = `https://${COGNITO_DOMAIN}/oauth2/token`;
            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    client_id: COGNITO_CLIENT_ID,
                    code,
                    redirect_uri: COGNITO_REDIRECT_URI,
                }),
            });

            if (!response.ok) {
                throw new Error('Token exchange failed');
            }

            const tokens = await response.json();

            // Parse ID token for user info
            const idPayload = JSON.parse(atob(tokens.id_token.split('.')[1]));

            const newUser: User = {
                id: idPayload.sub,
                email: idPayload.email,
                name: idPayload.name || idPayload.email,
                picture: idPayload.picture,
                plan: 'free', // Will be updated from backend
            };

            // Store tokens and user
            localStorage.setItem(TOKEN_KEY, tokens.access_token);
            localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
            localStorage.setItem(USER_KEY, JSON.stringify(newUser));

            setAccessToken(tokens.access_token);
            setUser(newUser);

        } catch (error) {
            console.error('OAuth callback error:', error);
            clearAuth();
        }
    }

    async function refreshToken() {
        const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!storedRefreshToken || !COGNITO_DOMAIN || !COGNITO_CLIENT_ID) {
            clearAuth();
            return;
        }

        try {
            const tokenEndpoint = `https://${COGNITO_DOMAIN}/oauth2/token`;
            const response = await fetch(tokenEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    client_id: COGNITO_CLIENT_ID,
                    refresh_token: storedRefreshToken,
                }),
            });

            if (!response.ok) {
                throw new Error('Token refresh failed');
            }

            const tokens = await response.json();
            localStorage.setItem(TOKEN_KEY, tokens.access_token);
            setAccessToken(tokens.access_token);

        } catch (error) {
            console.error('Token refresh error:', error);
            clearAuth();
        }
    }

    function login() {
        if (DEPLOY_MODE !== 'cloud' || !COGNITO_DOMAIN || !COGNITO_CLIENT_ID) {
            console.warn('Login only available in cloud mode with Cognito configured');
            return;
        }

        // Redirect to Cognito hosted UI
        const authUrl = new URL(`https://${COGNITO_DOMAIN}/oauth2/authorize`);
        authUrl.searchParams.set('client_id', COGNITO_CLIENT_ID);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'openid email profile');
        authUrl.searchParams.set('redirect_uri', COGNITO_REDIRECT_URI);

        window.location.href = authUrl.toString();
    }

    function logout() {
        clearAuth();

        if (DEPLOY_MODE === 'cloud' && COGNITO_DOMAIN && COGNITO_CLIENT_ID) {
            // Redirect to Cognito logout
            const logoutUrl = new URL(`https://${COGNITO_DOMAIN}/logout`);
            logoutUrl.searchParams.set('client_id', COGNITO_CLIENT_ID);
            logoutUrl.searchParams.set('logout_uri', window.location.origin);
            window.location.href = logoutUrl.toString();
        }
    }

    function clearAuth() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setAccessToken(null);
        setUser(null);
    }

    const value: AuthContextType = {
        user,
        isAuthenticated: !!user,
        isLoading,
        accessToken,
        login,
        logout,
        refreshToken,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextType {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
