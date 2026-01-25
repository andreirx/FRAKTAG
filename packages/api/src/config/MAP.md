# api/src/config/

Centralized environment configuration and validation.

## Structure

```
env.ts                    # Environment variable validation and defaults
```

## env.ts

Validates and exports typed configuration:

```typescript
export const config = {
  deployMode: process.env.FRAKTAG_DEPLOY_MODE || 'local',
  storageAdapter: process.env.STORAGE_ADAPTER || 'fs',
  storageRoot: process.env.STORAGE_ROOT || './data',

  // AWS (cloud mode)
  awsRegion: process.env.AWS_REGION || 'eu-central-1',
  cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID,
  cognitoClientId: process.env.COGNITO_CLIENT_ID,
  s3Bucket: process.env.S3_BUCKET_DATA,

  // Secrets
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiSecretArn: process.env.OPENAI_SECRET_ARN,

  // Paddle (monetization)
  paddleWebhookSecret: process.env.PADDLE_WEBHOOK_SECRET,

  // Limits
  demoDocLimit: 1,
  demoQueryLimit: 1,
};
```

## Validation

Throws on startup if required vars missing for the deploy mode:
- `cloud` requires: COGNITO_*, S3_BUCKET_DATA
- `enterprise` with s3: requires S3_BUCKET_DATA
- All modes require: OPENAI_API_KEY or OPENAI_SECRET_ARN
