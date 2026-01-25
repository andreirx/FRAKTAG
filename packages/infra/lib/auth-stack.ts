/**
 * Auth Stack - Cognito User Pool with Google OAuth.
 * Supports reusing an existing User Pool.
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export interface AuthStackProps extends cdk.StackProps {
    existingUserPoolId?: string;
    existingUserPoolArn?: string;
}

export class AuthStack extends cdk.Stack {
    public readonly userPool: cognito.IUserPool;
    public readonly userPoolClient: cognito.IUserPoolClient;
    public readonly identityPool?: cognito.CfnIdentityPool;

    constructor(scope: Construct, id: string, props?: AuthStackProps) {
        super(scope, id, props);

        // ===================
        // USER POOL
        // ===================

        if (props?.existingUserPoolId) {
            // Reuse existing User Pool
            this.userPool = cognito.UserPool.fromUserPoolId(
                this,
                'ExistingUserPool',
                props.existingUserPoolId
            );

            console.log(`Reusing existing User Pool: ${props.existingUserPoolId}`);
        } else {
            // Create new User Pool
            this.userPool = new cognito.UserPool(this, 'UserPool', {
                userPoolName: 'fraktag-users',
                selfSignUpEnabled: true,
                signInAliases: {
                    email: true,
                },
                autoVerify: {
                    email: true,
                },
                standardAttributes: {
                    email: {
                        required: true,
                        mutable: true,
                    },
                    fullname: {
                        required: false,
                        mutable: true,
                    },
                },
                customAttributes: {
                    plan: new cognito.StringAttribute({ mutable: true }),
                },
                passwordPolicy: {
                    minLength: 8,
                    requireLowercase: true,
                    requireUppercase: true,
                    requireDigits: true,
                    requireSymbols: false,
                },
                accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
                removalPolicy: cdk.RemovalPolicy.RETAIN,
            });

            // Add Google Identity Provider
            // Note: Google Client ID and Secret need to be configured manually
            // or passed via context/environment
            const googleClientId = this.node.tryGetContext('googleClientId');
            const googleClientSecret = this.node.tryGetContext('googleClientSecret');

            if (googleClientId && googleClientSecret) {
                const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
                    this,
                    'GoogleProvider',
                    {
                        userPool: this.userPool as cognito.UserPool,
                        clientId: googleClientId,
                        clientSecretValue: cdk.SecretValue.unsafePlainText(googleClientSecret),
                        scopes: ['email', 'profile', 'openid'],
                        attributeMapping: {
                            email: cognito.ProviderAttribute.GOOGLE_EMAIL,
                            fullname: cognito.ProviderAttribute.GOOGLE_NAME,
                            profilePicture: cognito.ProviderAttribute.GOOGLE_PICTURE,
                        },
                    }
                );
            }
        }

        // ===================
        // USER POOL CLIENT
        // ===================

        // App client for the UI
        const clientProps: cognito.UserPoolClientOptions = {
            userPool: this.userPool,
            userPoolClientName: 'fraktag-web-client',
            generateSecret: false, // SPA doesn't use client secret
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                    implicitCodeGrant: true,
                },
                scopes: [
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.PROFILE,
                ],
                callbackUrls: [
                    'http://localhost:5173/auth/callback', // Local dev
                    'https://localhost:5173/auth/callback',
                ],
                logoutUrls: [
                    'http://localhost:5173',
                    'https://localhost:5173',
                ],
            },
            preventUserExistenceErrors: true,
            accessTokenValidity: cdk.Duration.hours(1),
            idTokenValidity: cdk.Duration.hours(1),
            refreshTokenValidity: cdk.Duration.days(30),
        };

        if (props?.existingUserPoolId) {
            // For existing user pool, we need to create the client differently
            this.userPoolClient = new cognito.UserPoolClient(
                this,
                'UserPoolClient',
                clientProps
            );
        } else {
            this.userPoolClient = (this.userPool as cognito.UserPool).addClient(
                'WebClient',
                clientProps
            );
        }

        // ===================
        // USER POOL DOMAIN
        // ===================

        if (!props?.existingUserPoolId) {
            // Add Cognito domain for hosted UI
            (this.userPool as cognito.UserPool).addDomain('Domain', {
                cognitoDomain: {
                    domainPrefix: `fraktag-${this.account}`,
                },
            });
        }

        // ===================
        // OUTPUTS
        // ===================

        new cdk.CfnOutput(this, 'UserPoolIdOutput', {
            value: this.userPool.userPoolId,
            exportName: 'FraktagUserPoolId',
        });

        new cdk.CfnOutput(this, 'UserPoolClientIdOutput', {
            value: this.userPoolClient.userPoolClientId,
            exportName: 'FraktagUserPoolClientId',
        });

        new cdk.CfnOutput(this, 'UserPoolArnOutput', {
            value: this.userPool.userPoolArn,
            exportName: 'FraktagUserPoolArn',
        });
    }
}
