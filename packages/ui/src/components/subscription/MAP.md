# ui/src/components/subscription/

Paddle payment integration components.

## Structure

```
PricingTable.tsx          # Subscription tier display
UpgradeModal.tsx          # In-app upgrade prompt when limits hit
SubscriptionStatus.tsx    # Current plan badge / usage display
```

## PricingTable.tsx

Displays subscription options:
- Free tier: 1 doc, 1 question
- Pro tier: Unlimited docs, unlimited questions
- Uses Paddle.js checkout overlay

## UpgradeModal.tsx

Triggered when user hits demo limits:
- "You've used your free question"
- CTA: "Upgrade to Pro" or "Download KB for local use"

## Paddle Integration

```typescript
// lib/paddle.ts
import { initializePaddle } from '@paddle/paddle-js';

export const paddle = await initializePaddle({
  environment: 'production',
  token: import.meta.env.VITE_PADDLE_CLIENT_TOKEN,
});

export const openCheckout = (priceId: string, userId: string) => {
  paddle.Checkout.open({
    items: [{ priceId, quantity: 1 }],
    customData: { userId },
  });
};
```
