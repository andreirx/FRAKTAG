/**
 * Paddle.js SDK integration for subscription payments.
 */

// Paddle configuration from environment
const PADDLE_CLIENT_TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN;
const PADDLE_ENVIRONMENT = import.meta.env.VITE_PADDLE_ENVIRONMENT || 'production';

// Price IDs from environment
const PADDLE_PRICE_PRO_MONTHLY = import.meta.env.VITE_PADDLE_PRICE_PRO_MONTHLY;
const PADDLE_PRICE_PRO_YEARLY = import.meta.env.VITE_PADDLE_PRICE_PRO_YEARLY;

// Paddle instance (lazy loaded)
let paddleInstance: any = null;

/**
 * Initialize Paddle.js SDK.
 * Call this once on app start.
 */
export async function initializePaddle(): Promise<any> {
    if (!PADDLE_CLIENT_TOKEN) {
        console.warn('Paddle client token not configured');
        return null;
    }

    if (paddleInstance) {
        return paddleInstance;
    }

    try {
        // Dynamic import Paddle.js (only if installed)
        // @ts-ignore - Optional dependency
        const paddleModule = await import('@paddle/paddle-js').catch(() => null);

        if (!paddleModule) {
            console.warn('Paddle.js not installed - subscription features disabled');
            return null;
        }

        paddleInstance = await paddleModule.initializePaddle({
            environment: PADDLE_ENVIRONMENT as 'production' | 'sandbox',
            token: PADDLE_CLIENT_TOKEN,
        });

        console.log('Paddle initialized successfully');
        return paddleInstance;
    } catch (error) {
        console.error('Failed to initialize Paddle:', error);
        return null;
    }
}

/**
 * Open checkout for Pro subscription.
 */
export async function openProCheckout(options: {
    userId: string;
    email?: string;
    period: 'monthly' | 'yearly';
    onSuccess?: () => void;
    onClose?: () => void;
}): Promise<void> {
    const paddle = await initializePaddle();
    if (!paddle) {
        console.error('Paddle not available');
        return;
    }

    const priceId = options.period === 'yearly'
        ? PADDLE_PRICE_PRO_YEARLY
        : PADDLE_PRICE_PRO_MONTHLY;

    if (!priceId) {
        console.error('Paddle price ID not configured');
        return;
    }

    paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customData: {
            userId: options.userId,
        },
        customer: options.email ? { email: options.email } : undefined,
        settings: {
            successUrl: `${window.location.origin}/subscription/success`,
            displayMode: 'overlay',
        },
    });
}

/**
 * Get subscription prices for display.
 */
export function getSubscriptionPrices() {
    return {
        monthly: {
            priceId: PADDLE_PRICE_PRO_MONTHLY,
            amount: 19, // USD
            currency: 'USD',
        },
        yearly: {
            priceId: PADDLE_PRICE_PRO_YEARLY,
            amount: 190, // USD (2 months free)
            currency: 'USD',
            savings: '17%',
        },
    };
}
