/**
 * Pricing table component displaying subscription tiers.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check, Sparkles } from 'lucide-react';
import { useAuth } from '@/components/auth';
import { openProCheckout, getSubscriptionPrices } from '@/lib/paddle';

interface PricingTableProps {
    onUpgrade?: () => void;
}

export function PricingTable({ onUpgrade }: PricingTableProps) {
    const { user } = useAuth();
    const [period, setPeriod] = useState<'monthly' | 'yearly'>('yearly');
    const prices = getSubscriptionPrices();

    const handleUpgrade = async () => {
        if (!user) return;

        await openProCheckout({
            userId: user.id,
            email: user.email,
            period,
            onSuccess: onUpgrade,
        });
    };

    const freeTier = {
        name: 'Free',
        description: 'Try FRAKTAG with limited features',
        features: [
            'Ingest 1 document',
            'Ask 1 question',
            'Download your KB for local use',
            'Basic email support',
        ],
    };

    const proTier = {
        name: 'Pro',
        description: 'Unlimited knowledge curation',
        features: [
            'Unlimited document ingestion',
            'Unlimited questions',
            'Priority processing',
            'Advanced chunking controls',
            'API access',
            'Priority support',
        ],
    };

    return (
        <div className="space-y-6">
            {/* Period Toggle */}
            <div className="flex justify-center">
                <div className="inline-flex items-center p-1 bg-zinc-100 rounded-lg">
                    <button
                        onClick={() => setPeriod('monthly')}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            period === 'monthly'
                                ? 'bg-white shadow text-zinc-900'
                                : 'text-zinc-600 hover:text-zinc-900'
                        }`}
                    >
                        Monthly
                    </button>
                    <button
                        onClick={() => setPeriod('yearly')}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            period === 'yearly'
                                ? 'bg-white shadow text-zinc-900'
                                : 'text-zinc-600 hover:text-zinc-900'
                        }`}
                    >
                        Yearly
                        <span className="ml-1.5 text-xs text-green-600 font-semibold">
                            Save {prices.yearly.savings}
                        </span>
                    </button>
                </div>
            </div>

            {/* Pricing Cards */}
            <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
                {/* Free Tier */}
                <div className="bg-white rounded-xl border p-6">
                    <h3 className="text-lg font-semibold">{freeTier.name}</h3>
                    <p className="text-sm text-zinc-500 mt-1">{freeTier.description}</p>

                    <div className="mt-4">
                        <span className="text-3xl font-bold">$0</span>
                        <span className="text-zinc-500 ml-1">/forever</span>
                    </div>

                    <ul className="mt-6 space-y-3">
                        {freeTier.features.map((feature, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm">
                                <Check className="w-4 h-4 text-green-500 shrink-0" />
                                {feature}
                            </li>
                        ))}
                    </ul>

                    <Button
                        variant="outline"
                        className="w-full mt-6"
                        disabled={user?.plan === 'free'}
                    >
                        {user?.plan === 'free' ? 'Current Plan' : 'Get Started'}
                    </Button>
                </div>

                {/* Pro Tier */}
                <div className="bg-gradient-to-b from-purple-50 to-white rounded-xl border-2 border-purple-200 p-6 relative">
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="bg-purple-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                            RECOMMENDED
                        </span>
                    </div>

                    <h3 className="text-lg font-semibold flex items-center gap-2">
                        {proTier.name}
                        <Sparkles className="w-4 h-4 text-purple-500" />
                    </h3>
                    <p className="text-sm text-zinc-500 mt-1">{proTier.description}</p>

                    <div className="mt-4">
                        <span className="text-3xl font-bold">
                            ${period === 'yearly' ? Math.round(prices.yearly.amount / 12) : prices.monthly.amount}
                        </span>
                        <span className="text-zinc-500 ml-1">/month</span>
                        {period === 'yearly' && (
                            <span className="block text-xs text-zinc-400 mt-1">
                                Billed ${prices.yearly.amount}/year
                            </span>
                        )}
                    </div>

                    <ul className="mt-6 space-y-3">
                        {proTier.features.map((feature, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm">
                                <Check className="w-4 h-4 text-purple-500 shrink-0" />
                                {feature}
                            </li>
                        ))}
                    </ul>

                    <Button
                        onClick={handleUpgrade}
                        className="w-full mt-6 bg-purple-600 hover:bg-purple-700"
                        disabled={user?.plan === 'pro' || user?.plan === 'unlimited'}
                    >
                        {user?.plan === 'pro' || user?.plan === 'unlimited'
                            ? 'Current Plan'
                            : 'Upgrade to Pro'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
