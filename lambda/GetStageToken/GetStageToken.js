// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { IVSRealTimeClient, CreateParticipantTokenCommand } = require('@aws-sdk/client-ivs-realtime');
const { Logger } = require('@aws-lambda-powertools/logger');

const logger = new Logger({ serviceName: 'get-stage-token' });

function defaultHeader() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*'
  };
}

exports.handler = async function (event, context) {
  logger.addContext(context);

  try {
    const body = JSON.parse(event.body || '{}');
    const { stageArn, username, capabilities, attributes } = body;

    if (!stageArn) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          ...defaultHeader()
        },
        body: JSON.stringify({ message: 'Stage ARN is required' })
      };
    }

    const client = new IVSRealTimeClient();

    const command = new CreateParticipantTokenCommand({
      stageArn: stageArn,
      userId: attributes.username,
      capabilities: capabilities || ['PUBLISH', 'SUBSCRIBE'],
      attributes: attributes || {},
      duration: 720 // 12 hours in minutes
    });

    const response = await client.send(command);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...defaultHeader()
      },
      body: JSON.stringify({
        token: response.participantToken.token,
        participantId: response.participantToken.participantId,
        expirationTime: response.participantToken.expirationTime
      })
    };
  } catch (e) {
    logger.error('Error generating participant token: ', e);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        ...defaultHeader()
      },
      body: JSON.stringify({ message: e.message })
    };
  }
};
