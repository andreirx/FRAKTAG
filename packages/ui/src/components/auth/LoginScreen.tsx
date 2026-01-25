/**
 * Login screen for cloud deployment.
 * Shows Google OAuth sign-in button.
 */

import { useAuth } from './AuthProvider';
import { Button } from '@/components/ui/button';
import { Database } from 'lucide-react';

export function LoginScreen() {
    const { login, isLoading } = useAuth();

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-zinc-50 to-zinc-100">
            <div className="w-full max-w-md mx-auto px-6">
                {/* Logo / Branding */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-purple-600 mb-4">
                        <Database className="w-8 h-8 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-zinc-900">FRAKTAG</h1>
                    <p className="text-zinc-500 mt-2">
                        Enterprise-grade knowledge curation & retrieval
                    </p>
                </div>

                {/* Login Card */}
                <div className="bg-white rounded-2xl shadow-xl border p-8">
                    <h2 className="text-xl font-semibold text-center mb-6">
                        Sign in to continue
                    </h2>

                    {/* Google Sign-In Button */}
                    <Button
                        onClick={login}
                        disabled={isLoading}
                        className="w-full h-12 bg-white hover:bg-zinc-50 text-zinc-700 border shadow-sm"
                        variant="outline"
                    >
                        <svg className="w-5 h-5 mr-3" viewBox="0 0 24 24">
                            <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                                fill="#34A853"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                                fill="#FBBC05"
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            />
                            <path
                                fill="#EA4335"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                        </svg>
                        Continue with Google
                    </Button>

                    {/* Divider */}
                    <div className="relative my-6">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-zinc-200" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-white px-2 text-zinc-400">Free tier includes</span>
                        </div>
                    </div>

                    {/* Feature List */}
                    <ul className="space-y-3 text-sm text-zinc-600">
                        <li className="flex items-center gap-2">
                            <span className="text-green-500">✓</span>
                            Ingest 1 document (PDF or write your own)
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="text-green-500">✓</span>
                            Ask 1 question with AI-powered retrieval
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="text-green-500">✓</span>
                            Download your knowledge base for local use
                        </li>
                    </ul>

                    {/* Upgrade CTA */}
                    <div className="mt-6 p-4 bg-purple-50 rounded-lg border border-purple-100">
                        <p className="text-sm text-purple-700 text-center">
                            Need unlimited access?{' '}
                            <a href="#pricing" className="font-semibold underline">
                                View Pro plans
                            </a>
                        </p>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-xs text-zinc-400 text-center mt-6">
                    By signing in, you agree to our{' '}
                    <a href="/terms" className="underline">Terms</a>
                    {' '}and{' '}
                    <a href="/privacy" className="underline">Privacy Policy</a>
                </p>
            </div>
        </div>
    );
}
