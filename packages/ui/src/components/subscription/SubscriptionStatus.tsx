/**
 * Subscription status badge and usage display.
 */

import { useAuth } from '@/components/auth';
import { Sparkles, FileText, MessageSquare } from 'lucide-react';

interface UsageData {
    docsUsed: number;
    docsLimit: number;
    queriesUsed: number;
    queriesLimit: number;
}

interface SubscriptionStatusProps {
    usage?: UsageData;
    compact?: boolean;
}

export function SubscriptionStatus({ usage, compact = false }: SubscriptionStatusProps) {
    const { user } = useAuth();

    if (!user) return null;

    // Plan badge styling
    const getPlanStyle = () => {
        switch (user.plan) {
            case 'pro':
                return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'unlimited':
                return 'bg-gradient-to-r from-purple-100 to-indigo-100 text-purple-700 border-purple-200';
            default:
                return 'bg-zinc-100 text-zinc-600 border-zinc-200';
        }
    };

    const getPlanLabel = () => {
        switch (user.plan) {
            case 'pro':
                return 'PRO';
            case 'unlimited':
                return 'UNLIMITED';
            default:
                return 'FREE';
        }
    };

    // Compact mode: just the badge
    if (compact) {
        return (
            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded border ${getPlanStyle()}`}>
                {(user.plan === 'pro' || user.plan === 'unlimited') && (
                    <Sparkles className="w-3 h-3" />
                )}
                {getPlanLabel()}
            </span>
        );
    }

    // Full mode: badge + usage
    return (
        <div className="space-y-3">
            {/* Plan Badge */}
            <div className="flex items-center justify-between">
                <span className="text-sm text-zinc-500">Current Plan</span>
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded border ${getPlanStyle()}`}>
                    {(user.plan === 'pro' || user.plan === 'unlimited') && (
                        <Sparkles className="w-3 h-3" />
                    )}
                    {getPlanLabel()}
                </span>
            </div>

            {/* Usage Stats (for free tier) */}
            {user.plan === 'free' && usage && (
                <div className="space-y-2">
                    {/* Documents */}
                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-zinc-600">
                            <FileText className="w-4 h-4" />
                            Documents
                        </div>
                        <span className={usage.docsUsed >= usage.docsLimit ? 'text-red-500 font-medium' : 'text-zinc-500'}>
                            {usage.docsUsed} / {usage.docsLimit}
                        </span>
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${
                                usage.docsUsed >= usage.docsLimit ? 'bg-red-500' : 'bg-purple-500'
                            }`}
                            style={{ width: `${Math.min((usage.docsUsed / usage.docsLimit) * 100, 100)}%` }}
                        />
                    </div>

                    {/* Questions */}
                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-zinc-600">
                            <MessageSquare className="w-4 h-4" />
                            Questions
                        </div>
                        <span className={usage.queriesUsed >= usage.queriesLimit ? 'text-red-500 font-medium' : 'text-zinc-500'}>
                            {usage.queriesUsed} / {usage.queriesLimit}
                        </span>
                    </div>
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all ${
                                usage.queriesUsed >= usage.queriesLimit ? 'bg-red-500' : 'bg-purple-500'
                            }`}
                            style={{ width: `${Math.min((usage.queriesUsed / usage.queriesLimit) * 100, 100)}%` }}
                        />
                    </div>
                </div>
            )}

            {/* Unlimited indicator for paid users */}
            {(user.plan === 'pro' || user.plan === 'unlimited') && (
                <p className="text-xs text-zinc-400 text-center">
                    Unlimited documents and questions
                </p>
            )}
        </div>
    );
}
