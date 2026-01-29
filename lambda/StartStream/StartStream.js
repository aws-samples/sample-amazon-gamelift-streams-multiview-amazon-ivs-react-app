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
    // Validate AdditionalEnvironmentVariables if provided
    if (body.AdditionalEnvironmentVariables !== undefined) {
      if (typeof body.AdditionalEnvironmentVariables !== 'object' || body.AdditionalEnvironmentVariables === null || Array.isArray(body.AdditionalEnvironmentVariables)) {
        throw new Error('AdditionalEnvironmentVariables must be an object');
      }

      // Validate all keys and values are strings
      for (const [key, value] of Object.entries(body.AdditionalEnvironmentVariables)) {
        if (typeof key !== 'string' || typeof value !== 'string') {
          throw new Error('All environment variable keys and values must be strings');
        }
      }
    }

    // Use the first region from the Regions array to configure the client
    // This ensures the API call goes to the correct regional endpoint
    const targetRegion = body.Regions && body.Regions.length > 0 ? body.Regions[0] : undefined;
    const gameLiftStreams = new GameLiftStreams({ region: targetRegion });

    // Build the request parameters
    const requestParams = {
      Identifier: body.SGIdentifier,
      ApplicationIdentifier: body.AppIdentifier,
      Protocol: 'WebRTC', // current only supported Value
      UserId: body.UserId,
      SignalRequest: body.SignalRequest,
      ConnectionTimeoutSeconds: Number(process.env.CONNECTION_TIMEOUT || 120),
      Locations: body.Regions
    };

    // Add AdditionalEnvironmentVariables if provided
    if (body.AdditionalEnvironmentVariables) {
      requestParams.AdditionalEnvironmentVariables = body.AdditionalEnvironmentVariables;
    }

    let streamSession = await gameLiftStreams.startStreamSession(requestParams);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        ...defaultHeader()
      },
      body: JSON.stringify({
        signalResponse: streamSession.SignalResponse ?? '',
        arn: streamSession.Arn,
        region: streamSession.Location,
        status: streamSession.Status
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
