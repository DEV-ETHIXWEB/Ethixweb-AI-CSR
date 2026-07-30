# Terraform — infrastructure as code

Per [docs/10-deployment-cicd.md](../../docs/10-deployment-cicd.md) §5: no manually-created AWS infrastructure — everything here, applied via `terraform apply`, reproducibly.

## Honesty note on verification status

**This configuration has not been run against a real AWS account.** No AWS credentials exist in the environment this was authored in, and the Terraform CLI itself isn't installed there either — so nothing here has been through `terraform validate` (syntax-only) or `terraform plan` (semantic/API-shape check against a real provider), let alone `terraform apply`. The HCL is written carefully and correctly against the AWS provider's documented resource schema, but per this project's own engineering standard of not claiming untested things work: **run `terraform validate` and `terraform plan` against real credentials, and read the plan output line by line, before the first `terraform apply`.** This is exactly the same caveat [05-crm-integration.md](../../docs/05-crm-integration.md) §2.9 applies to the Housecall Pro adapter's unverified API assumptions — untested-but-carefully-written is a different category from either "known correct" or "placeholder," and should be labeled as such, not rounded up to either neighbor.

## Structure

```
infra/terraform/
  modules/
    networking/    VPC, public/private subnets (2 AZs), NAT gateways, route tables
    ecs-cluster/   ECS Fargate cluster + capacity providers + ECR repositories
    database/      RDS PostgreSQL, Multi-AZ, RDS-managed master credential (never in state)
    cache/         ElastiCache Redis replication group, Multi-AZ
  environments/
    staging/       Root module wiring the above at staging sizing
    production/    Not yet created — added alongside the staging environment's
                    first successful real deploy, sized per docs/09-cost-analysis.md
```

## What's deliberately not built yet, and why

Per this project's "no placeholder code" standard — these aren't stubbed in as fake resources, they're simply not present until the thing they'd configure actually exists:

- **ECS service/task-definition modules for `core-api` and `voice-orchestrator`**: a task definition needs a real container image URI. The ECR repositories these will push to already exist (`modules/ecs-cluster`), but the service module itself is added once a Dockerfile and a built image exist (tracked in [docs/13-implementation-backlog.md](../../docs/13-implementation-backlog.md) "Cross-module / platform-level tasks").
- **`environments/production/`**: created from the same modules once staging has been applied and verified against real AWS at least once — copy-pasting an unverified environment twice doubles the blast radius of a mistake for no benefit.
- **CodeDeploy blue/green application** ([docs/10](../../docs/10-deployment-cicd.md) §3): depends on the voice-orchestrator ECS service existing first.
- **Application-level Secrets Manager entries** (CRM credentials, LLM API keys, SIP trunk credentials — [docs/08-security-observability-reliability.md](../../docs/08-security-observability-reliability.md) §1.2): provisioned per-tenant/per-integration at onboarding time, not as static Terraform resources.
- **Multi-region / DR infrastructure** ([docs/17-disaster-recovery-multi-region-compliance.md](../../docs/17-disaster-recovery-multi-region-compliance.md)): explicitly deferred to its own evidence-based trigger, not built speculatively.

## RDS credential model

`modules/database` uses `manage_master_user_password = true` — RDS generates and owns the master credential directly in Secrets Manager; it never appears in a `.tf` file, `terraform plan` output, or state in plaintext. The application itself never connects as this master user: the RLS migration (`packages/database/prisma/migrations/00000000000002_rls_policies`) creates a separate, non-owning `app_runtime` Postgres role (see [docs/20-architecture-decision-records.md](../../docs/20-architecture-decision-records.md) ADR-013/ADR-014 for why two roles, not one), whose password is set out-of-band during environment provisioning and rotated per [docs/19-operational-runbooks.md](../../docs/19-operational-runbooks.md) §7 — not tracked in this Terraform config at all.

## Before the first real `terraform apply`

1. Bootstrap the S3 state bucket + DynamoDB lock table referenced in `environments/staging/providers.tf` (a backend can't create the backend it depends on — this is a one-time manual or separate-bootstrap-config step, done once per AWS account).
2. `terraform init`, `terraform validate`, `terraform plan` — read the plan output.
3. Confirm the AWS region matches whatever [docs/02-voice-pipeline-and-telephony.md](../../docs/02-voice-pipeline-and-telephony.md) sign-off settles on for the voice vendor's nearest PoP (`us-east-1` here is a placeholder default, not a confirmed decision).
