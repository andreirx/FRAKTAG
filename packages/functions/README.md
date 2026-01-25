# @fraktag/functions

AWS Lambda handlers for FRAKTAG cloud deployment.

## IMPORTANT: This package is NOT for local development!

For local development, you only need:
- `packages/engine` - The Fraktag engine
- `packages/api` - Express API server
- `packages/ui` - React UI

Run locally with:
```bash
# From monorepo root
pnpm --filter api dev
pnpm --filter ui dev
```

## When to use this package

This package is **only** needed when:
1. Deploying to AWS Lambda
2. Building the serverless infrastructure

## Building for deployment

```bash
# Install AWS dependencies first
pnpm install

# Build Lambda handlers
pnpm --filter @fraktag/functions build
```

## Contents

- `api-handler.ts` - Lambda handler wrapping Express API
- `stream-handler.ts` - Lambda Function URL handler for SSE streaming
- `ingestion-worker.ts` - S3-triggered Lambda for async document processing
- `webhooks/paddle.ts` - Paddle payment webhook handler
