/**
 * Monitoring Stack - CloudWatch dashboards and alarms.
 */

import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface MonitoringStackProps extends cdk.StackProps {
    apiFunction: lambda.IFunction;
    ingestionFunction: lambda.IFunction;
    dataBucket: s3.IBucket;
}

export class MonitoringStack extends cdk.Stack {
    public readonly dashboard: cloudwatch.Dashboard;

    constructor(scope: Construct, id: string, props: MonitoringStackProps) {
        super(scope, id, props);

        // ===================
        // DASHBOARD
        // ===================

        this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
            dashboardName: 'FRAKTAG-Operations',
        });

        // API Function Metrics
        const apiInvocations = props.apiFunction.metricInvocations({
            period: cdk.Duration.minutes(5),
        });
        const apiErrors = props.apiFunction.metricErrors({
            period: cdk.Duration.minutes(5),
        });
        const apiDuration = props.apiFunction.metricDuration({
            period: cdk.Duration.minutes(5),
        });

        // Ingestion Function Metrics
        const ingestionInvocations = props.ingestionFunction.metricInvocations({
            period: cdk.Duration.minutes(5),
        });
        const ingestionErrors = props.ingestionFunction.metricErrors({
            period: cdk.Duration.minutes(5),
        });
        const ingestionDuration = props.ingestionFunction.metricDuration({
            period: cdk.Duration.minutes(5),
        });

        // Dashboard Widgets
        this.dashboard.addWidgets(
            new cloudwatch.TextWidget({
                markdown: '# FRAKTAG Operations Dashboard\nReal-time monitoring of API and ingestion workloads.',
                width: 24,
                height: 1,
            })
        );

        this.dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'API Lambda - Invocations & Errors',
                left: [apiInvocations],
                right: [apiErrors],
                width: 12,
                height: 6,
            }),
            new cloudwatch.GraphWidget({
                title: 'API Lambda - Duration',
                left: [apiDuration],
                width: 12,
                height: 6,
            })
        );

        this.dashboard.addWidgets(
            new cloudwatch.GraphWidget({
                title: 'Ingestion Worker - Invocations & Errors',
                left: [ingestionInvocations],
                right: [ingestionErrors],
                width: 12,
                height: 6,
            }),
            new cloudwatch.GraphWidget({
                title: 'Ingestion Worker - Duration',
                left: [ingestionDuration],
                width: 12,
                height: 6,
            })
        );

        // ===================
        // ALARMS
        // ===================

        // API Error Rate Alarm
        new cloudwatch.Alarm(this, 'ApiErrorAlarm', {
            alarmName: 'FRAKTAG-API-HighErrorRate',
            alarmDescription: 'API Lambda error rate is high',
            metric: apiErrors,
            threshold: 5,
            evaluationPeriods: 2,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // API Duration Alarm
        new cloudwatch.Alarm(this, 'ApiDurationAlarm', {
            alarmName: 'FRAKTAG-API-HighLatency',
            alarmDescription: 'API Lambda duration is high (>5s)',
            metric: apiDuration,
            threshold: 5000, // 5 seconds
            evaluationPeriods: 3,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // Ingestion Error Alarm
        new cloudwatch.Alarm(this, 'IngestionErrorAlarm', {
            alarmName: 'FRAKTAG-Ingestion-Errors',
            alarmDescription: 'Ingestion worker is failing',
            metric: ingestionErrors,
            threshold: 1,
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // Ingestion Timeout Alarm (close to 15min limit)
        new cloudwatch.Alarm(this, 'IngestionTimeoutAlarm', {
            alarmName: 'FRAKTAG-Ingestion-NearTimeout',
            alarmDescription: 'Ingestion worker is approaching timeout limit',
            metric: ingestionDuration,
            threshold: 840000, // 14 minutes (840 seconds)
            evaluationPeriods: 1,
            comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
            treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        });

        // ===================
        // OUTPUTS
        // ===================

        new cdk.CfnOutput(this, 'DashboardUrl', {
            value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${this.dashboard.dashboardName}`,
            exportName: 'FraktagDashboardUrl',
        });
    }
}
