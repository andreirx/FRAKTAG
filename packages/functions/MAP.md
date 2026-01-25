# packages/functions

AWS Lambda handlers for serverless deployment.

## Structure

```
src/
├── api-handler.ts        # Wraps Express app for Lambda Proxy (API Gateway)
├── stream-handler.ts     # Lambda Function URL handler for SSE streaming
├── ingestion-worker.ts   # Async PDF processor triggered by S3/EventBridge
└── webhooks/
    └── paddle.ts         # Payment subscription webhook handler
```

## Dependencies

- `packages/api` - Wraps the Express server
- `packages/engine` - Core processing logic

## Environment Variables

- `FRAKTAG_DEPLOY_MODE=cloud`
- `AWS_REGION=eu-central-1`
- `DYNAMODB_TABLE_USERS`
- `DYNAMODB_TABLE_JOBS`
- `S3_BUCKET_DATA`
- `OPENAI_API_KEY` (from Secrets Manager)

## Build

Uses esbuild to tree-shake and bundle for Lambda deployment.
Output consumed by `packages/infra` CDK stacks.
