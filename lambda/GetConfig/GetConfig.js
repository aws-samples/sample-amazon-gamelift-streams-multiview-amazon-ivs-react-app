// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const { SSMClient, GetParametersByPathCommand } = require('@aws-sdk/client-ssm');

const ssmClient = new SSMClient();
const PARAMETER_PATH = process.env.SSM_PARAMETER_PATH;

// Cache parameters for 5 minutes to reduce SSM API calls
let cachedParams = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getParameters() {
  const now = Date.now();
  if (cachedParams && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedParams;
  }

  const params = {};
  let nextToken;

  do {
    const command = new GetParametersByPathCommand({
      Path: PARAMETER_PATH,
      Recursive: true,
      WithDecryption: true,
      NextToken: nextToken,
    });
    const response = await ssmClient.send(command);

    for (const param of response.Parameters || []) {
      // Strip the path prefix to get the key name, e.g. /app/secrets/APPSYNC_API_KEY -> APPSYNC_API_KEY
      const key = param.Name.replace(`${PARAMETER_PATH}/`, '');
      params[key] = param.Value;
    }
    nextToken = response.NextToken;
  } while (nextToken);

  cachedParams = params;
  cacheTimestamp = now;
  return params;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Content-Type': 'application/json',
  };

  try {
    const params = await getParameters();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(params),
    };
  } catch (error) {
    console.error('Failed to retrieve configuration:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to retrieve configuration' }),
    };
  }
};
