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

    // Use the control plane region from the request to configure the client
    // GameLift Streams control plane availability is limited to specific regions
    const controlPlaneRegion = body.ControlPlaneRegion;
    if (!controlPlaneRegion) {
      throw new Error('ControlPlaneRegion is required');
    }

    const gameLiftStreams = new GameLiftStreams({ region: controlPlaneRegion });

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
