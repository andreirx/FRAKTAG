# packages/infra

AWS CDK Infrastructure as Code for FRAKTAG cloud deployment.

## Structure

```
bin/
└── fraktag-app.ts        # CDK App entry point

lib/
├── storage-stack.ts      # S3 buckets + DynamoDB tables
├── auth-stack.ts         # Cognito User Pool + Google OAuth
├── compute-stack.ts      # Lambda functions + API Gateway + Function URLs
└── monitoring-stack.ts   # CloudWatch dashboards + alarms
```

## Stacks

### StorageStack
- S3 bucket for user data (`tenants/{userId}/`)
- S3 bucket for staging uploads
- DynamoDB: Users table (sub, email, plan, quotas)
- DynamoDB: Jobs table (ingestion status tracking)

### AuthStack
- Cognito User Pool
- Google Identity Provider
- App Client for UI

### ComputeStack
- API Handler Lambda (Express wrapper)
- Stream Handler Lambda (Function URL for SSE)
- Ingestion Worker Lambda (EventBridge triggered)
- Paddle Webhook Lambda
- API Gateway HTTP API
- CloudFront distribution

### MonitoringStack
- CloudWatch Log Groups
- Error rate alarms
- Lambda duration metrics

## Deployment

```bash
cd packages/infra
npx cdk deploy --all --region eu-central-1
```

## Dependencies

- `packages/functions` - Lambda code to deploy
