/**
 * Authentication guard component.
 * Conditionally renders children or login screen based on auth state and deploy mode.
 */

import { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { LoginScreen } from './LoginScreen';
import { Loader2 } from 'lucide-react';

// Deploy mode from environment
const DEPLOY_MODE = import.meta.env.VITE_DEPLOY_MODE || 'local';

interface AuthGuardProps {
    children: ReactNode;
    /** If true, shows loading spinner while checking auth. Default: true */
    showLoading?: boolean;
    /** Custom loading component */
    loadingComponent?: ReactNode;
    /** If true, allows anonymous access but still loads auth state */
    allowAnonymous?: boolean;
}

export function AuthGuard({
    children,
    showLoading = true,
    loadingComponent,
    allowAnonymous = false,
}: AuthGuardProps) {
    const { isAuthenticated, isLoading } = useAuth();

    // Show loading state
    if (isLoading) {
        if (!showLoading) {
            return null;
        }

        return loadingComponent || (
            <div className="min-h-screen flex items-center justify-center bg-zinc-50">
                <div className="text-center space-y-4">
                    <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto" />
                    <p className="text-sm text-zinc-500">Loading...</p>
                </div>
            </div>
        );
    }

    // Local mode: Always show children (no auth required)
    if (DEPLOY_MODE === 'local') {
        return <>{children}</>;
    }

    // Enterprise mode: Usually no auth, but could be configured
    if (DEPLOY_MODE === 'enterprise') {
        // Enterprise typically uses VPN/SSO, so passthrough
        return <>{children}</>;
    }

    // Cloud mode: Require authentication
    if (DEPLOY_MODE === 'cloud') {
        // Allow anonymous access if configured
        if (allowAnonymous) {
            return <>{children}</>;
        }

        // Not authenticated: show login screen
        if (!isAuthenticated) {
            return <LoginScreen />;
        }

        // Authenticated: show children
        return <>{children}</>;
    }

    // Unknown mode: passthrough
    return <>{children}</>;
}
