/**
 * Compute Stack - Lambda functions, API Gateway, CloudFront.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ComputeStackProps extends cdk.StackProps {
    dataBucket: s3.IBucket;
    stagingBucket: s3.IBucket;
    usersTable: dynamodb.ITable;
    jobsTable: dynamodb.ITable;
    userPool: cognito.IUserPool;
    userPoolClient: cognito.IUserPoolClient;
    openaiSecretArn?: string;
    sesSenderEmail?: string;
}

export class ComputeStack extends cdk.Stack {
    public readonly apiFunction: lambda.Function;
    public readonly ingestionFunction: lambda.Function;
    public readonly streamFunction: lambda.Function;
    public readonly apiUrl: string;
    public readonly cloudFrontUrl: string;

    constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

        // ===================
        // SHARED LAMBDA CONFIG
        // ===================

        const commonEnv = {
            FRAKTAG_DEPLOY_MODE: 'cloud',
            STORAGE_ADAPTER: 's3',
            S3_BUCKET_DATA: props.dataBucket.bucketName,
            S3_BUCKET_STAGING: props.stagingBucket.bucketName,
            DYNAMODB_TABLE_USERS: props.usersTable.tableName,
            DYNAMODB_TABLE_JOBS: props.jobsTable.tableName,
            COGNITO_USER_POOL_ID: props.userPool.userPoolId,
            COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
            ...(props.openaiSecretArn && { OPENAI_SECRET_ARN: props.openaiSecretArn }),
            ...(props.sesSenderEmail && { SES_SENDER_EMAIL: props.sesSenderEmail }),
        };

        // Reference OpenAI secret if ARN provided
        let openaiSecret: secretsmanager.ISecret | undefined;
        if (props.openaiSecretArn) {
            openaiSecret = secretsmanager.Secret.fromSecretCompleteArn(
                this,
                'OpenAISecret',
                props.openaiSecretArn
            );
        }

        // ===================
        // API LAMBDA
        // ===================

        this.apiFunction = new lambda.Function(this, 'ApiFunction', {
            functionName: 'fraktag-api',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'api-handler.handler',
            code: lambda.Code.fromAsset(
                path.join(__dirname, '../../functions/dist'),
                { exclude: ['ingestion-worker.js', 'stream-handler.js'] }
            ),
            memorySize: 1024,
            timeout: cdk.Duration.seconds(30),
            environment: commonEnv,
            tracing: lambda.Tracing.ACTIVE,
        });

        // ===================
        // STREAM LAMBDA (Function URL for SSE)
        // ===================

        this.streamFunction = new lambda.Function(this, 'StreamFunction', {
            functionName: 'fraktag-stream',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'stream-handler.handler',
            code: lambda.Code.fromAsset(
                path.join(__dirname, '../../functions/dist'),
                { exclude: ['api-handler.js', 'ingestion-worker.js'] }
            ),
            memorySize: 1024,
            timeout: cdk.Duration.minutes(5), // Longer for streaming
            environment: commonEnv,
            tracing: lambda.Tracing.ACTIVE,
        });

        // Add Function URL for streaming
        const streamFunctionUrl = this.streamFunction.addFunctionUrl({
            authType: lambda.FunctionUrlAuthType.NONE, // Auth handled in code
            invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
            cors: {
                allowedOrigins: ['*'],
                allowedMethods: [lambda.HttpMethod.POST, lambda.HttpMethod.OPTIONS],
                allowedHeaders: ['*'],
            },
        });

        // ===================
        // INGESTION WORKER LAMBDA
        // ===================

        this.ingestionFunction = new lambda.Function(this, 'IngestionFunction', {
            functionName: 'fraktag-ingestion-worker',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'ingestion-worker.handler',
            code: lambda.Code.fromAsset(
                path.join(__dirname, '../../functions/dist'),
                { exclude: ['api-handler.js', 'stream-handler.js'] }
            ),
            memorySize: 2048, // More memory for PDF processing
            timeout: cdk.Duration.minutes(15), // Max Lambda timeout
            environment: commonEnv,
            tracing: lambda.Tracing.ACTIVE,
        });

        // ===================
        // PADDLE WEBHOOK LAMBDA
        // ===================

        const paddleFunction = new lambda.Function(this, 'PaddleWebhookFunction', {
            functionName: 'fraktag-paddle-webhook',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'webhooks/paddle.handler',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../functions/dist')),
            memorySize: 256,
            timeout: cdk.Duration.seconds(30),
            environment: {
                DYNAMODB_TABLE_USERS: props.usersTable.tableName,
                PADDLE_WEBHOOK_SECRET: process.env.PADDLE_WEBHOOK_SECRET || '',
            },
        });

        // ===================
        // PERMISSIONS
        // ===================

        // Grant S3 access
        props.dataBucket.grantReadWrite(this.apiFunction);
        props.dataBucket.grantReadWrite(this.streamFunction);
        props.dataBucket.grantReadWrite(this.ingestionFunction);
        props.stagingBucket.grantRead(this.ingestionFunction);
        props.stagingBucket.grantDelete(this.ingestionFunction);

        // Grant DynamoDB access
        props.usersTable.grantReadWriteData(this.apiFunction);
        props.usersTable.grantReadWriteData(this.streamFunction);
        props.usersTable.grantReadWriteData(this.ingestionFunction);
        props.usersTable.grantReadWriteData(paddleFunction);
        props.jobsTable.grantReadWriteData(this.apiFunction);
        props.jobsTable.grantReadWriteData(this.ingestionFunction);

        // Grant Secrets Manager access
        if (openaiSecret) {
            openaiSecret.grantRead(this.apiFunction);
            openaiSecret.grantRead(this.streamFunction);
            openaiSecret.grantRead(this.ingestionFunction);
        }

        // Grant SES access
        if (props.sesSenderEmail) {
            const sesPolicy = new iam.PolicyStatement({
                actions: ['ses:SendEmail', 'ses:SendRawEmail'],
                resources: ['*'], // Scoped by SES identity
            });
            this.ingestionFunction.addToRolePolicy(sesPolicy);
        }

        // ===================
        // S3 EVENT → INGESTION WORKER
        // ===================

        // EventBridge rule for S3 uploads to staging bucket
        const s3EventRule = new events.Rule(this, 'StagingUploadRule', {
            eventPattern: {
                source: ['aws.s3'],
                detailType: ['Object Created'],
                detail: {
                    bucket: { name: [props.stagingBucket.bucketName] },
                    object: { key: [{ prefix: 'staging/' }] },
                },
            },
        });

        s3EventRule.addTarget(new eventsTargets.LambdaFunction(this.ingestionFunction));

        // Enable EventBridge notifications on staging bucket
        // Note: This requires the bucket to have EventBridge enabled
        // which is done via S3 bucket properties

        // ===================
        // API GATEWAY
        // ===================

        const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
            apiName: 'fraktag-api',
            corsPreflight: {
                allowOrigins: ['*'],
                allowMethods: [
                    apigatewayv2.CorsHttpMethod.GET,
                    apigatewayv2.CorsHttpMethod.POST,
                    apigatewayv2.CorsHttpMethod.PUT,
                    apigatewayv2.CorsHttpMethod.PATCH,
                    apigatewayv2.CorsHttpMethod.DELETE,
                    apigatewayv2.CorsHttpMethod.OPTIONS,
                ],
                allowHeaders: ['*'],
            },
        });

        // API routes
        httpApi.addRoutes({
            path: '/api/{proxy+}',
            methods: [apigatewayv2.HttpMethod.ANY],
            integration: new apigatewayv2Integrations.HttpLambdaIntegration(
                'ApiIntegration',
                this.apiFunction
            ),
        });

        // Paddle webhook route
        httpApi.addRoutes({
            path: '/webhooks/paddle',
            methods: [apigatewayv2.HttpMethod.POST],
            integration: new apigatewayv2Integrations.HttpLambdaIntegration(
                'PaddleIntegration',
                paddleFunction
            ),
        });

        this.apiUrl = httpApi.apiEndpoint;

        // ===================
        // STATIC SITE BUCKET
        // ===================

        const siteBucket = new s3.Bucket(this, 'SiteBucket', {
            bucketName: `fraktag-site-${this.account}-${this.region}`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
        });

        // ===================
        // CLOUDFRONT
        // ===================

        // Origin Access Identity for S3
        const originAccessIdentity = new cloudfront.OriginAccessIdentity(
            this,
            'SiteOAI',
            { comment: 'FRAKTAG Site OAI' }
        );
        siteBucket.grantRead(originAccessIdentity);

        // CloudFront distribution
        const distribution = new cloudfront.Distribution(this, 'Distribution', {
            defaultBehavior: {
                origin: new cloudfrontOrigins.S3Origin(siteBucket, {
                    originAccessIdentity,
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
            additionalBehaviors: {
                '/api/*': {
                    origin: new cloudfrontOrigins.HttpOrigin(
                        `${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`
                    ),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                },
                '/webhooks/*': {
                    origin: new cloudfrontOrigins.HttpOrigin(
                        `${httpApi.apiId}.execute-api.${this.region}.amazonaws.com`
                    ),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                },
            },
            defaultRootObject: 'index.html',
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html', // SPA routing
                },
            ],
        });

        this.cloudFrontUrl = `https://${distribution.distributionDomainName}`;

        // ===================
        // OUTPUTS
        // ===================

        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: this.apiUrl,
            exportName: 'FraktagApiUrl',
        });

        new cdk.CfnOutput(this, 'StreamFunctionUrl', {
            value: streamFunctionUrl.url,
            exportName: 'FraktagStreamUrl',
        });

        new cdk.CfnOutput(this, 'CloudFrontDomain', {
            value: this.cloudFrontUrl,
            exportName: 'FraktagCloudFrontUrl',
        });

        new cdk.CfnOutput(this, 'SiteBucketName', {
            value: siteBucket.bucketName,
            exportName: 'FraktagSiteBucket',
        });
    }
}
