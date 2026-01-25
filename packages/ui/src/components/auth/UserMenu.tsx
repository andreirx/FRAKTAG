/**
 * User menu dropdown.
 * Shows user info and logout option in cloud mode.
 */

import { useAuth } from './AuthProvider';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { User, LogOut, Download, CreditCard } from 'lucide-react';

// Deploy mode from environment
const DEPLOY_MODE = import.meta.env.VITE_DEPLOY_MODE || 'local';

export function UserMenu() {
    const { user, logout } = useAuth();

    // Don't show in local mode
    if (DEPLOY_MODE === 'local') {
        return null;
    }

    if (!user) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                    {user.picture ? (
                        <img
                            src={user.picture}
                            alt={user.name || 'User'}
                            className="w-6 h-6 rounded-full"
                        />
                    ) : (
                        <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center">
                            <User className="w-4 h-4 text-purple-600" />
                        </div>
                    )}
                    <span className="text-sm font-medium hidden sm:inline">
                        {user.name || user.email || 'User'}
                    </span>
                </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                    <div className="flex flex-col">
                        <span className="font-medium">{user.name || 'User'}</span>
                        {user.email && (
                            <span className="text-xs text-zinc-400 font-normal">
                                {user.email}
                            </span>
                        )}
                    </div>
                </DropdownMenuLabel>

                <DropdownMenuSeparator />

                {/* Plan Badge */}
                <div className="px-2 py-1.5">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500">Plan</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            user.plan === 'pro' || user.plan === 'unlimited'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-zinc-100 text-zinc-600'
                        }`}>
                            {user.plan === 'unlimited' ? 'UNLIMITED' : user.plan.toUpperCase()}
                        </span>
                    </div>
                </div>

                <DropdownMenuSeparator />

                {/* Upgrade option for free users */}
                {user.plan === 'free' && (
                    <DropdownMenuItem className="cursor-pointer">
                        <CreditCard className="w-4 h-4 mr-2" />
                        Upgrade to Pro
                    </DropdownMenuItem>
                )}

                {/* Download KB option */}
                <DropdownMenuItem className="cursor-pointer">
                    <Download className="w-4 h-4 mr-2" />
                    Download Knowledge Base
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                {/* Logout */}
                <DropdownMenuItem
                    className="cursor-pointer text-red-600 focus:text-red-600"
                    onClick={logout}
                >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
