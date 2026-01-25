/**
 * Storage Stack - S3 buckets and DynamoDB tables for FRAKTAG.
 */

import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class StorageStack extends cdk.Stack {
    public readonly dataBucket: s3.Bucket;
    public readonly stagingBucket: s3.Bucket;
    public readonly usersTable: dynamodb.Table;
    public readonly jobsTable: dynamodb.Table;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // ===================
        // S3 BUCKETS
        // ===================

        // Main data bucket for processed knowledge bases
        // Structure: tenants/{userId}/trees/{treeId}/...
        this.dataBucket = new s3.Bucket(this, 'DataBucket', {
            bucketName: `fraktag-data-${this.account}-${this.region}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            versioned: true, // Keep version history
            lifecycleRules: [
                {
                    id: 'DeleteOldVersions',
                    noncurrentVersionExpiration: cdk.Duration.days(30),
                },
            ],
            cors: [
                {
                    allowedHeaders: ['*'],
                    allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
                    allowedOrigins: ['*'], // Will be restricted in production
                    maxAge: 3600,
                },
            ],
            removalPolicy: cdk.RemovalPolicy.RETAIN, // Don't delete user data
        });

        // Staging bucket for uploads before processing
        // Structure: staging/{userId}/{jobId}/{fileName}
        this.stagingBucket = new s3.Bucket(this, 'StagingBucket', {
            bucketName: `fraktag-staging-${this.account}-${this.region}`,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            lifecycleRules: [
                {
                    id: 'ExpireStaging',
                    expiration: cdk.Duration.days(1), // Auto-cleanup after 24h
                },
            ],
            cors: [
                {
                    allowedHeaders: ['*'],
                    allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
                    allowedOrigins: ['*'],
                    maxAge: 3600,
                },
            ],
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Staging data is temporary
            autoDeleteObjects: true,
        });

        // ===================
        // DYNAMODB TABLES
        // ===================

        // Users table - stores user profiles and quotas
        this.usersTable = new dynamodb.Table(this, 'UsersTable', {
            tableName: 'fraktag-users',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            pointInTimeRecovery: true,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // Add GSI for email lookup
        this.usersTable.addGlobalSecondaryIndex({
            indexName: 'email-index',
            partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // Jobs table - tracks async ingestion jobs
        this.jobsTable = new dynamodb.Table(this, 'JobsTable', {
            tableName: 'fraktag-jobs',
            partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            encryption: dynamodb.TableEncryption.AWS_MANAGED,
            timeToLiveAttribute: 'ttl', // Auto-expire old jobs
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // Add GSI for user's jobs lookup
        this.jobsTable.addGlobalSecondaryIndex({
            indexName: 'userId-index',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // ===================
        // OUTPUTS
        // ===================

        new cdk.CfnOutput(this, 'DataBucketName', {
            value: this.dataBucket.bucketName,
            exportName: 'FraktagDataBucket',
        });

        new cdk.CfnOutput(this, 'StagingBucketName', {
            value: this.stagingBucket.bucketName,
            exportName: 'FraktagStagingBucket',
        });

        new cdk.CfnOutput(this, 'UsersTableName', {
            value: this.usersTable.tableName,
            exportName: 'FraktagUsersTable',
        });

        new cdk.CfnOutput(this, 'JobsTableName', {
            value: this.jobsTable.tableName,
            exportName: 'FraktagJobsTable',
        });
    }
}
