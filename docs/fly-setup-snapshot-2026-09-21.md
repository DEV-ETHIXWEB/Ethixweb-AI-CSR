# Fly.io setup snapshot, 2026-09-21

Decision: no changes. Kept voice-runtime at 2 machines and kept every setting below as is.

## Apps and machines (region sjc for all)

| App | Machines | Size | Auto-stop | Notes |
|---|---|---|---|---|
| ethixweb-voice-runtime | 2 (both started) | performance-1x, 2 GB | off, min 1 | Holds live Twilio call state. Performance CPU avoids audio stutter. |
| ethixweb-voice-orchestrator | 2 (1 started, 1 suspended) | shared-cpu-1x, 1 GB | suspend, min 1 | |
| ethixweb-core-api | 1 (started) | shared-cpu-1x, 1 GB | off, min 1 | Sends lead SMS on a timer, so it must not stop. |
| ethixweb-dashboard | 2 (1 started, 1 suspended) | shared-cpu-1x, 1 GB | suspend, min 1 | |

Total: 7 machines. Managed Postgres `ethixweb-db`: basic plan, 10 GB, 1 replica, used only by core-api.

## Deployed release

Commit 9d85666. Releases: core-api v5, dashboard v4, voice-orchestrator v15, voice-runtime v10.

## Memory in use when idle (2026-09-21)

core-api ~390 MB, voice-orchestrator ~290 MB, dashboard ~230 MB, voice-runtime ~285 MB.

## Cost

Invoice lines from the last billing view: Performance CPU 1x $16.51, Additional RAM $3.00, MPG cluster $8.47.
Estimate from Fly's published rates: about $123/month total, of which voice-runtime is ~$64 and Postgres ~$41.
Exact figures need the Fly billing page.

## Options not taken

- voice-runtime 2 to 1 machine: saves about $32/month. Cost: no failover on a crash or deploy.
- dashboard 1 GB to 512 MB: saves about $1 to $2/month.

Revisit both once real call volume is known.
