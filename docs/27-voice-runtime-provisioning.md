# 27 — Voice Runtime Provisioning

Ops runbook fragment, not an essay — the concrete external-account setup and CLI commands needed to take `apps/voice-runtime` from "code that typechecks" to "answers a real phone call." Written the same way [docs/25](25-service-credential-provisioning.md) documents the core-api key minting: the actual commands, not a description of the concept.

## 1. Four accounts only a human can create

`apps/voice-runtime` cannot run against a real call without these. None of them can be provisioned by an agent — account creation and payment details are out of scope for automated setup.

| Account | What you need back | Goes in `apps/voice-runtime/.env` as |
| --- | --- | --- |
| [LiveKit Cloud](https://cloud.livekit.io) project | Project URL, API key, API secret | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| [Twilio](https://www.twilio.com) account + a phone number | Account SID, Auth Token, the number itself | Not read by voice-runtime directly — used in step 3 below to configure the SIP trunk |
| [Deepgram](https://deepgram.com) account | API key | `DEEPGRAM_API_KEY` |
| [Cartesia](https://cartesia.ai) account | API key + a chosen voice ID from your account's voice library | `CARTESIA_API_KEY`, `CARTESIA_VOICE_ID` |

`ORCHESTRATOR_SERVICE_TOKEN` is not a vendor credential — generate it with `openssl rand -base64 48` and set the identical value in both `apps/voice-orchestrator/.env` and `apps/voice-runtime/.env` (shared secret, not an issued credential — see that file's own comment).

## 2. Install the LiveKit CLI (`lk`)

Everything below uses `lk`, LiveKit's own CLI — not something this repo vendors. Install per [LiveKit's CLI docs](https://docs.livekit.io/home/cli/cli-setup/), then authenticate it against your project:

```bash
lk cloud auth
```

## 3. Twilio: create the SIP trunk and point it at LiveKit

Twilio remains the pure SIP/PSTN carrier — LiveKit is the agent runtime (docs/02 §2's picked architecture). Using the Twilio CLI:

```bash
twilio api trunking v1 trunks create \
  --friendly-name "ethixweb-voice-runtime" \
  --domain-name "ethixweb-voice-runtime.pstn.twilio.com"
```

Note the returned trunk SID, then point its origination URI at your LiveKit project's SIP host (find the exact host in the LiveKit Cloud dashboard's SIP settings page):

```bash
twilio api trunking v1 trunks origination-urls create \
  --trunk-sid <twilio_trunk_sid> \
  --friendly-name "LiveKit SIP URI" \
  --sip-url "sip:<your-livekit-sip-host>;transport=tcp" \
  --weight 1 --priority 1 --enabled
```

Associate the pilot tenant's phone number with the trunk:

```bash
twilio api trunking v1 trunks phone-numbers create \
  --trunk-sid <twilio_trunk_sid> \
  --phone-number-sid <twilio_phone_number_sid>
```

## 4. LiveKit: inbound trunk + dispatch rule

Two LiveKit-side objects, both created once and reused for every call (per LiveKit's own guidance — never recreated per call).

**Inbound trunk** — `inbound-trunk.json`:

```json
{
  "trunk": {
    "name": "ethixweb-pilot-inbound",
    "numbers": ["+1XXXXXXXXXX"]
  }
}
```

```bash
lk sip inbound create inbound-trunk.json
```

**Dispatch rule** — routes the call to a room and dispatches `apps/voice-runtime`'s worker by the `agentName` it registers under (`"voice-runtime"`, set in `agent.ts`'s `ServerOptions`). `dispatch-rule.json`:

```json
{
  "dispatch_rule": {
    "rule": {
      "dispatchRuleIndividual": {
        "roomPrefix": "call-"
      }
    },
    "name": "ethixweb-pilot-dispatch",
    "roomConfig": {
      "agents": [{ "agentName": "voice-runtime" }]
    }
  }
}
```

```bash
lk sip dispatch create dispatch-rule.json
```

`dispatchRuleIndividual` creates a fresh room per caller (named `call-<phone-number>-<random suffix>`) — the correct choice here, since each call needs its own isolated room/conversation.

## 5. LiveKit: outbound trunk (for emergency transfer only)

`WarmTransferTask` (docs/02 §4, wired in `agent.ts`'s `transferExecutor`) needs a separate **outbound** trunk to dial the on-call technician's phone — distinct from the inbound trunk above. Skip this step if emergency SIP transfer isn't being tested yet; nothing else in the runtime depends on it.

`outbound-trunk.json`:

```json
{
  "trunk": {
    "name": "ethixweb-pilot-outbound",
    "address": "<your-sip-provider-address>",
    "numbers": ["+1XXXXXXXXXX"]
  }
}
```

```bash
lk sip outbound create outbound-trunk.json \
  --auth-user "$SIP_AUTH_USERNAME" \
  --auth-pass "$SIP_AUTH_PASSWORD"
```

Set the returned trunk ID as `LIVEKIT_SIP_OUTBOUND_TRUNK` in `apps/voice-runtime/.env` — `WarmTransferTaskOptions.sipTrunkId` falls back to this exact environment variable name when not passed explicitly (which `agent.ts` doesn't — it relies on this fallback).

## 6. Run it

```bash
pnpm --filter @ethixweb/voice-runtime start
```

Place a real call to the Twilio number from step 3. Trace it end-to-end: LiveKit dispatches the job → `agent.ts`'s `entry` reads `sip.phoneNumber`/`sip.trunkPhoneNumber` off the SIP participant → `CallSession.start()` calls voice-orchestrator's `POST /v1/conversations` → each finalized STT transcript drives a turn → Cartesia speaks the response.

## 7. What this doc deliberately doesn't cover

- **Call recording** (LiveKit egress → S3) — needs a separate AWS S3 bucket/IAM decision, out of scope for getting a call working at all.
- **Production-grade SIP security** (IP allowlisting, TLS/SRTP enforcement) — [docs/18-abuse-prevention-and-telephony-fraud.md](18-abuse-prevention-and-telephony-fraud.md) §3, a go-live gate, not a first-call prerequisite.
- **Multi-tenant DID routing** — this runtime is Phase-1 single-tenant by design (see `apps/voice-runtime/src/config.ts`'s own comment); every inbound call resolves to the one static `PILOT_TENANT_ID`/`PILOT_BUSINESS_ID` in `.env`.
