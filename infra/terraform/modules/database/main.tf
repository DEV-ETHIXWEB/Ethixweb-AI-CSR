# RDS PostgreSQL — Multi-AZ, per docs/01-architecture-overview.md §9 and
# docs/17-disaster-recovery-multi-region-compliance.md §1 (backup/PITR/DR
# objectives). The master credential is never a Terraform variable or state
# value — `manage_master_user_password = true` has RDS generate it directly
# into Secrets Manager, so it never passes through this config at all. The
# application itself never connects as the master user: the RLS migration
# (packages/database/prisma/migrations/*_rls_policies) creates a separate,
# non-owning `app_runtime` role, and that role's password is set
# out-of-band (docs/19-operational-runbooks.md §7 credential rotation) —
# this module only needs to produce a reachable, encrypted Postgres
# instance, not provision application-level credentials.

terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "allowed_security_group_ids" {
  type        = list(string)
  description = "Security groups (e.g. the ECS service's) permitted to reach Postgres on 5432."
}

variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "allocated_storage_gb" {
  type    = number
  default = 50
}

variable "multi_az" {
  type    = bool
  default = true
}

variable "backup_retention_days" {
  type    = number
  default = 14
}

variable "deletion_protection" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name_prefix}-db-subnets"
  subnet_ids = var.private_subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "db" {
  name        = "${var.name_prefix}-db-sg"
  description = "Postgres access — inbound 5432 only from application security groups, no public ingress"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Postgres from application services"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-db-sg" })
}

resource "aws_db_parameter_group" "main" {
  name   = "${var.name_prefix}-pg16"
  family = "postgres16"

  # log_statement is intentionally NOT set to "all" — that would capture
  # full query text (including PII bound parameters) in RDS logs, at odds
  # with docs/08-security-observability-reliability.md §1.4's PII-handling
  # posture. Slow-query logging only.
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = var.tags
}

resource "aws_db_instance" "main" {
  identifier     = "${var.name_prefix}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.allocated_storage_gb * 4 # storage autoscaling ceiling
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "ethixweb_csr"
  username = "ethixweb_admin"
  # RDS generates and owns this secret end-to-end — it never appears in
  # Terraform state, plan output, or this configuration.
  manage_master_user_password = true

  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.main.name

  backup_retention_period = var.backup_retention_days
  backup_window           = "03:00-04:00" # low-traffic window, tenant-timezone-agnostic at Phase 1's single-region scale
  maintenance_window      = "mon:04:30-mon:05:30"
  copy_tags_to_snapshot   = true

  # Cross-region snapshot replication (docs/17 §1.2) is configured at the
  # AWS Backup / DR-region level, not on the instance resource itself — see
  # infra/terraform/modules/database/README.md once that module is added
  # (tracked as a Phase 3 item, gated on the same trigger as multi-region
  # compute in docs/17 §2.2, not built speculatively now).

  deletion_protection      = var.deletion_protection
  skip_final_snapshot      = false
  final_snapshot_identifier = "${var.name_prefix}-postgres-final"

  performance_insights_enabled = true

  tags = var.tags
}

output "endpoint" {
  value = aws_db_instance.main.endpoint
}

output "security_group_id" {
  value = aws_security_group.db.id
}

output "master_user_secret_arn" {
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
  description = "Secrets Manager ARN holding the RDS-generated master credential — for migration-role bootstrapping only, never the app's runtime credential."
}
