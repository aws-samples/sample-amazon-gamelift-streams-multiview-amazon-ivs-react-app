# PubNub Transport for Couch Co-Op

This guide explains how to configure PubNub as the message transport for couch co-op commands
(SPAWN_PLAYER, MOVE_PLAYER, DESPAWN_PLAYER) instead of the default AWS AppSync Event API.

## Why PubNub?

AppSync Event API works well for chat and control messages, but couch co-op input commands
are high-frequency (up to 20/sec per viewer) and ephemeral — they don't need history, ordering
guarantees, or the overhead of a WebSocket subscription protocol. PubNub's fire-and-forget
publish model is a natural fit for this traffic pattern.

The transport layer is abstracted behind a `MessageTransport` interface, so you can swap
providers by changing a single constant. Chat, viewer invites, and all other messages continue
to flow through AppSync regardless of this setting.

## Architecture

```
ViewerView.tsx
    │
    ├── Chat / Invites ──► AppSyncChatClient (always)
    │
    └── Couch Co-Op ──► MessageTransport interface
                            ├── AppSyncTransport (default)
                            └── PubNubTransport  (opt-in)
```

## Step 1: Create a PubNub Account and Keyset

1. Sign up at [pubnub.com](https://www.pubnub.com/) (free tier is sufficient).
2. Create an App and a Keyset in the PubNub Admin Portal.
3. Note your **Publish Key** and **Subscribe Key**.
4. No additional features (Presence, Storage, etc.) are required for this use case.

## Step 2: Store PubNub Credentials in AWS SSM Parameter Store

The app's `GetConfig` Lambda fetches all parameters under a configured SSM path
set via the `SSM_PARAMETER_PATH` environment variable on the Lambda. This path is
defined in the CDK stack at `lib/amazon-gamelift-streams-react-starter-ivs-stack.ts`:

```typescript
const ssmParameterPath = `/${this.stackName}/secrets`;
```

So the actual path is `/<YourStackName>/secrets` (e.g., `/AmazonGameliftStreamsReactStarterIVSStack/secrets`).

Add three new parameters under that path:

```bash
# Replace <YourStackName> with your actual CDK stack name

aws ssm put-parameter \
  --name "/<YourStackName>/secrets/PUBNUB_PUBLISH_KEY" \
  --type "SecureString" \
  --value "pub-c-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

aws ssm put-parameter \
  --name "/<YourStackName>/secrets/PUBNUB_SUBSCRIBE_KEY" \
  --type "SecureString" \
  --value "sub-c-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

aws ssm put-parameter \
  --name "/<YourStackName>/secrets/PUBNUB_CHANNEL_NAME" \
  --type "String" \
  --value "couch-coop"
```

The `GetConfig` Lambda will automatically pick these up on the next request (or after
its 5-minute cache expires). No Lambda code changes are needed.

### Verifying

After adding the parameters, you can verify they're returned by the config endpoint:

```bash
curl -H "Authorization: <your-cognito-id-token>" \
  https://<your-api-id>.execute-api.<region>.amazonaws.com/prod/config | jq .
```

You should see `PUBNUB_PUBLISH_KEY`, `PUBNUB_SUBSCRIBE_KEY`, and `PUBNUB_CHANNEL_NAME`
in the response alongside the existing AppSync parameters.

> **Tip:** To find your exact stack name, check `cdk ls` or look at the
> `SSM_PARAMETER_PATH` environment variable on the GetConfig Lambda in the AWS Console.

## Step 3: Set the Feature Flag

In `src/utils/constants.ts`, change the transport flag:

```typescript
// Switch from AppSync to PubNub for couch co-op commands
export const COUCH_COOP_TRANSPORT: string = 'pubnub';
```

That's it. The transport factory reads this flag and instantiates the correct provider.

## Step 4: Game-Side Subscription

Your game server (or Unity client) needs to subscribe to the same PubNub channel
(`couch-coop` by default) to receive the commands. The message payloads are identical
regardless of transport:

```json
{ "action": "SPAWN_PLAYER", "user": "CosmicTiger42", "message": "", "timestamp": "..." }
{ "action": "MOVE_PLAYER", "user": "CosmicTiger42", "message": "{\"keys\":[\"ArrowUp\"]}", "timestamp": "..." }
{ "action": "DESPAWN_PLAYER", "user": "CosmicTiger42", "message": "", "timestamp": "..." }
```

PubNub SDKs are available for Unity, Unreal, and most server-side languages.

## Adding Other Providers

To add a new transport (e.g., Ably, Pusher):

1. Create `src/utils/transports/MyNewTransport.ts` implementing `MessageTransport`.
2. Add a new case in `src/utils/transports/createTransport.ts`.
3. Add the corresponding SSM parameters for credentials.
4. Set `COUCH_COOP_TRANSPORT` to your new provider name.

## Rollback

Set `COUCH_COOP_TRANSPORT` back to `'appsync'` to revert. The PubNub SSM parameters
can remain in place — they'll simply be unused.
