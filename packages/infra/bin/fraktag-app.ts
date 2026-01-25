#!/usr/bin/env node
/**
 * FRAKTAG CDK App Entry Point
 * Deploys all stacks for cloud deployment.
 */

import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack.js';
import { AuthStack } from '../lib/auth-stack.js';
import { ComputeStack } from '../lib/compute-stack.js';
import { MonitoringStack } from '../lib/monitoring-stack.js';

const app = new cdk.App();

// Environment configuration
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-central-1',
};

// Stack configuration from context or environment
const config = {
    // Domain configuration (optional, uses CloudFront default if not set)
    domainName: app.node.tryGetContext('domainName'),
    certificateArn: app.node.tryGetContext('certificateArn'),

    // Existing resources to reuse
    existingUserPoolId: app.node.tryGetContext('cognitoUserPoolId'),
    existingUserPoolArn: app.node.tryGetContext('cognitoUserPoolArn'),

    // OpenAI secret ARN (already exists in your account)
    openaiSecretArn: app.node.tryGetContext('openaiSecretArn') ||
        process.env.OPENAI_SECRET_ARN,

    // SES configuration
    sesIdentityArn: app.node.tryGetContext('sesIdentityArn'),
    sesSenderEmail: app.node.tryGetContext('sesSenderEmail') || 'noreply@fraktag.com',
};

// Stack prefix for easy identification
const prefix = 'Fraktag';

// 1. Storage Stack - S3 buckets and DynamoDB tables
const storageStack = new StorageStack(app, `${prefix}Storage`, {
    env,
    description: 'FRAKTAG storage resources (S3, DynamoDB)',
});

// 2. Auth Stack - Cognito User Pool (or reuse existing)
const authStack = new AuthStack(app, `${prefix}Auth`, {
    env,
    description: 'FRAKTAG authentication (Cognito)',
    existingUserPoolId: config.existingUserPoolId,
    existingUserPoolArn: config.existingUserPoolArn,
});

// 3. Compute Stack - Lambda functions, API Gateway, CloudFront
const computeStack = new ComputeStack(app, `${prefix}Compute`, {
    env,
    description: 'FRAKTAG compute resources (Lambda, API Gateway, CloudFront)',
    dataBucket: storageStack.dataBucket,
    stagingBucket: storageStack.stagingBucket,
    usersTable: storageStack.usersTable,
    jobsTable: storageStack.jobsTable,
    userPool: authStack.userPool,
    userPoolClient: authStack.userPoolClient,
    openaiSecretArn: config.openaiSecretArn,
    sesSenderEmail: config.sesSenderEmail,
});

// 4. Monitoring Stack - CloudWatch dashboards and alarms
const monitoringStack = new MonitoringStack(app, `${prefix}Monitoring`, {
    env,
    description: 'FRAKTAG monitoring (CloudWatch)',
    apiFunction: computeStack.apiFunction,
    ingestionFunction: computeStack.ingestionFunction,
    dataBucket: storageStack.dataBucket,
});

// Add dependencies
authStack.addDependency(storageStack);
computeStack.addDependency(storageStack);
computeStack.addDependency(authStack);
monitoringStack.addDependency(computeStack);

// Output important values
new cdk.CfnOutput(app, 'ApiUrl', {
    value: computeStack.apiUrl,
    description: 'API Gateway URL',
});

new cdk.CfnOutput(app, 'CloudFrontUrl', {
    value: computeStack.cloudFrontUrl,
    description: 'CloudFront distribution URL',
});

new cdk.CfnOutput(app, 'UserPoolId', {
    value: authStack.userPool.userPoolId,
    description: 'Cognito User Pool ID',
});

new cdk.CfnOutput(app, 'UserPoolClientId', {
    value: authStack.userPoolClient.userPoolClientId,
    description: 'Cognito User Pool Client ID',
});

app.synth();
