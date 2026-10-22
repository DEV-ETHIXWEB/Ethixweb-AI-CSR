# Single-server test deployment (AWS, Sydney)

Cheapest working setup while the CSR is tested on the AWS Free-plan credits.
Everything runs on one EC2 machine with Docker Compose. It is for testing, not
for US production: Sydney adds call latency, and one machine has no failover.
The move to a US region is planned once the account is upgraded.

| Item         | Value                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------- |
| AWS account  | 493116365060 ("Blank Canvas" project), region `ap-southeast-2`                                    |
| Machine      | EC2 `c7i-flex.large` (2 vCPU, 4 GB), Amazon Linux 2023, 30 GB gp3, 2 GB swap                      |
| Name tag     | `ethixweb-csr` (instance, volume, Elastic IP); security group `ethixweb-csr`                      |
| Public IP    | Elastic IP 15.134.237.50                                                                          |
| Public URLs  | `https://voice.15-134-237-50.sslip.io` (Twilio), `https://app.15-134-237-50.sslip.io` (dashboard) |
| Private only | core-api, voice-orchestrator, Postgres 16, Redis 7                                                |
| SSH          | `ssh -i ~/.ssh/ethixweb-csr.pem ec2-user@15.134.237.50` (port 22 open to one IP only)             |

`sslip.io` turns the IP into a hostname so Caddy can get free Let's Encrypt
certificates without any DNS setup.

## Files

- `docker-compose.yml`: all services. Only Caddy publishes ports (80, 443).
- `Caddyfile`: HTTPS and routing for the two public hostnames.
- `env/*.env`: secrets, **on the server only** (chmod 600). The master copy is
  outside the repo on Akash's Mac in `AKASH_ETHIXWEB/CSR/aws-secrets-sydney/`.
  Variable names are listed in `docs/44-aws-migration-prerequisites.md`.
- `backup-db.sh` and `install-backup-timer.sh`: daily `pg_dump` at 03:00 UTC
  into `/opt/ethixweb/backups`, keeping 7 days.

## Redeploy after a code change

From the repo root on the Mac:

```bash
K=~/.ssh/ethixweb-csr.pem
rsync -az --delete -e "ssh -i $K" \
  --exclude node_modules --exclude .git --exclude .turbo --exclude dist --exclude .next \
  --exclude '*.tsbuildinfo' --exclude '.env' --exclude '.env.*' --exclude dump.rdb \
  --exclude IMP_touchups --exclude docs/call-concurrency.log --exclude infra/aws-single-server/env \
  ./ ec2-user@15.134.237.50:/opt/ethixweb/src/
ssh -i $K ec2-user@15.134.237.50 \
  'cd /opt/ethixweb/src/infra/aws-single-server && docker compose build <service> && docker compose up -d <service>'
```

Restarting voice-runtime waits up to 35 s for live calls to finish.

## Useful commands (on the server)

```bash
cd /opt/ethixweb/src/infra/aws-single-server
docker compose ps
docker compose logs -f --tail 100 voice-runtime
docker stats --no-stream
```

## How it was set up

- The database was restored from the verified Fly.io backup of 2026-10-10.
  `app_runtime` (the app's login) is not a superuser and cannot bypass
  row-level security; tables are owned by `postgres`.
- `TWILIO_SIGNATURE_VALIDATION_DISABLED` is deliberately not set, so Twilio
  webhook signatures are verified.
- The orchestrator's `CORE_API_SERVICE_API_KEY` is the existing key whose hash
  is in `api_keys`. JWT secrets and the integration master key were newly
  generated (no integration rows existed), so dashboard users sign in again.
