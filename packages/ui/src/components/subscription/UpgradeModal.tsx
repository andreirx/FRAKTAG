/**
 * Upgrade modal shown when user hits demo limits.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles, Download, ArrowRight } from 'lucide-react';
import { useAuth } from '@/components/auth';
import { openProCheckout } from '@/lib/paddle';

interface UpgradeModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    limitType: 'document' | 'question';
    onDownloadKB?: () => void;
}

export function UpgradeModal({ open, onOpenChange, limitType, onDownloadKB }: UpgradeModalProps) {
    const { user } = useAuth();

    const handleUpgrade = async () => {
        if (!user) return;

        await openProCheckout({
            userId: user.id,
            email: user.email,
            period: 'yearly',
            onSuccess: () => onOpenChange(false),
        });
    };

    const limitMessages = {
        document: {
            title: "You've reached your document limit",
            description: "Free accounts can ingest 1 document. Upgrade to Pro for unlimited document ingestion.",
        },
        question: {
            title: "You've used your free question",
            description: "Free accounts can ask 1 question. Upgrade to Pro for unlimited AI-powered queries.",
        },
    };

    const message = limitMessages[limitType];

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-purple-500" />
                        {message.title}
                    </DialogTitle>
                    <DialogDescription>
                        {message.description}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-4">
                    {/* Upgrade CTA */}
                    <div className="bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg p-4 border border-purple-100">
                        <h4 className="font-semibold text-purple-900">Upgrade to Pro</h4>
                        <ul className="mt-2 space-y-1 text-sm text-purple-700">
                            <li>• Unlimited document ingestion</li>
                            <li>• Unlimited questions</li>
                            <li>• Priority processing</li>
                        </ul>
                        <Button
                            onClick={handleUpgrade}
                            className="w-full mt-4 bg-purple-600 hover:bg-purple-700"
                        >
                            Upgrade Now
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                    </div>

                    {/* Divider */}
                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-zinc-200" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-zinc-400">or</span>
                        </div>
                    </div>

                    {/* Download KB Option */}
                    <div className="bg-zinc-50 rounded-lg p-4 border">
                        <h4 className="font-medium text-zinc-900">Continue locally</h4>
                        <p className="text-sm text-zinc-500 mt-1">
                            Download your knowledge base and use FRAKTAG locally with no limits.
                        </p>
                        <Button
                            variant="outline"
                            onClick={() => {
                                onDownloadKB?.();
                                onOpenChange(false);
                            }}
                            className="w-full mt-3"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Download Knowledge Base
                        </Button>
                    </div>

                    {/* Cancel */}
                    <Button
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="w-full"
                    >
                        Maybe later
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
