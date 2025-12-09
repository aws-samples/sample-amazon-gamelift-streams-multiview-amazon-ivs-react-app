// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import * as ivs from 'aws-cdk-lib/aws-ivs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as log from 'aws-cdk-lib/aws-logs';
import * as appsync from 'aws-cdk-lib/aws-appsync';

export interface IVSStackProps extends cdk.StackProps {
  userPool: cognito.IUserPool;
  api: apigateway.RestApi;
  auth: apigateway.CognitoUserPoolsAuthorizer;
}

export class AmazonGameliftStreamsReactStarterIVSStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IVSStackProps) {
    super(scope, id, props);

    // Create IVS Real-Time Stage for player-viewer streaming
    const stage = new ivs.CfnStage(this, 'gamelift-streams-ivs-stage', {
      name: this.stackName + '-realtime-stage',
    });

    // Create AppSync Event API for real-time chat and reactions using L2 construct
    const eventApi = new appsync.EventApi(this, 'gamelift-streams-event-api', {
      apiName: 'gamelift-streams-event-api',
      authorizationConfig: {
        authProviders: [
          {
            authorizationType: appsync.AppSyncAuthorizationType.API_KEY
          }
        ]
      }
    });

    // Add default channel namespace for chat
    const channelNamespace = eventApi.addChannelNamespace('default');

    // Create log group for IVS Lambda function
    const ivsLambdaLogGroup = new log.LogGroup(this, 'gamelift-streams-ivs-lambda-log-group', {
      logGroupName: `/aws/lambda/${this.stackName}-get-stage-token`,
      retention: log.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create Lambda function for generating IVS stage participant tokens
    const getStageTokenLambda = new lambda.Function(this, 'gamelift-streams-get-stage-token-lambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'GetStageToken.handler',
      code: lambda.Code.fromAsset('lambda/GetStageToken'),
      timeout: cdk.Duration.seconds(10),
      logGroup: ivsLambdaLogGroup,
    });

    // Grant Lambda permission to create participant tokens for any stage in this account
    // This allows flexibility to use multiple stages without redeploying the Lambda
    getStageTokenLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['ivs:CreateParticipantToken'],
      resources: [`arn:aws:ivs:${this.region}:${this.account}:stage/*`]
    }));

    // Add IVS token endpoint to the existing API Gateway with Cognito authorization
    const getStageToken = props.api.root.addResource('get-stage-token');
    getStageToken.addMethod('POST', new apigateway.LambdaIntegration(getStageTokenLambda, {
      timeout: cdk.Duration.seconds(10)
    }), {
      authorizer: props.auth,
      authorizationType: apigateway.AuthorizationType.COGNITO
    });

    // Outputs
    new cdk.CfnOutput(this, 'IVS-Stage-ARN', {
      value: stage.attrArn,
      description: 'Amazon IVS Real-Time Stage ARN'
    });

    new cdk.CfnOutput(this, 'AppSync-Event-API-Endpoint', {
      value: eventApi.apiArn || `arn:aws:appsync:${this.region}:${this.account}:apis/${eventApi.apiId}`,
      description: 'AppSync Event API ARN'
    });

    // Get the first API key from the apiKeys object
    const apiKeyId = Object.keys(eventApi.apiKeys)[0];
    const apiKey = apiKeyId ? eventApi.apiKeys[apiKeyId] : undefined;

    new cdk.CfnOutput(this, 'AppSync-Event-API-Key', {
      value: apiKey ? apiKey.attrApiKey : 'No API Key generated',
      description: 'AppSync Event API Key'
    });

    new cdk.CfnOutput(this, 'AppSync-HTTP-Endpoint', {
      value: `https://${eventApi.httpDns}`,
      description: 'AppSync HTTP endpoint'
    });

    new cdk.CfnOutput(this, 'AppSync-Realtime-Endpoint', {
      value: eventApi.realtimeDns,
      description: 'AppSync Realtime WebSocket endpoint'
    });

    new cdk.CfnOutput(this, 'AppSync-Channel-Namespace', {
      value: `/default/${eventApi.apiId}`,
      description: 'AppSync Event API default channel namespace'
    });

    /**
     * Nag Suppressions
     */
    NagSuppressions.addResourceSuppressions(getStageTokenLambda, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Using AWS Lambda Basic Execution Role is acceptable for this sample application. In production, consider using custom IAM policies.',
        appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole']
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permission for IVS stages is acceptable for this sample application to allow flexibility with multiple stages. In production, consider restricting to specific stage ARNs.',
        appliesTo: [`Resource::arn:aws:ivs:${this.region}:${this.account}:stage/*`]
      }
    ], true);
  }
}
