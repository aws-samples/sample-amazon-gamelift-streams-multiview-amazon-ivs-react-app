// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { GameLiftStreams } = require('@aws-sdk/client-gameliftstreams');
const { Logger } = require('@aws-lambda-powertools/logger');
const logger = new Logger({ serviceName: 'start-stream-session' });

function defaultHeader() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*'
  };
}

exports.handler = async function (event, context) {
  logger.addContext(context);

  const body = JSON.parse(event.body);
  try {
    // extract individual parts from the stream session ARN
    const parts = body.SessionIdentifier.split("/");
    const sg_arn = parts[parts.length - 2];

    // Extract region from the session ARN (format: arn:aws:gameliftstreams:REGION:ACCOUNT:...)
    const arnParts = body.SessionIdentifier.split(':');
    const targetRegion = arnParts.length >= 4 ? arnParts[3] : undefined;

    const gameLiftStreams = new GameLiftStreams({ region: targetRegion });

    let streamSession = await gameLiftStreams.createStreamSessionConnection({
      Identifier: sg_arn,
      StreamSessionIdentifier: body.SessionIdentifier,
      SignalRequest: body.SignalRequest,
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...defaultHeader()
      },
      body: JSON.stringify({
        signalResponse: streamSession.SignalResponse ?? '',
      })
    };
  } catch (e) {
    logger.error('Something went wrong: ', e);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        ...defaultHeader()
      },
      body: JSON.stringify({ 'message': e.message })
    };
  }
};
