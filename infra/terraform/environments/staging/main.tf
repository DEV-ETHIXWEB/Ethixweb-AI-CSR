module "networking" {
  source = "../../modules/networking"

  name_prefix        = local.name_prefix
  availability_zones = ["${var.aws_region}a", "${var.aws_region}b"]
  tags               = local.common_tags
}

module "ecs_cluster" {
  source = "../../modules/ecs-cluster"

  name_prefix = local.name_prefix
  tags        = local.common_tags
}

# The security group every ECS task (core-api, voice-orchestrator, workers)
# joins, once their service module exists (docs/13-implementation-backlog.md
# "Cross-module / platform-level tasks" #5) — created here, ahead of those
# services, so the database/cache modules below have a real ingress source
# to scope access to rather than a temporary 0.0.0.0/0 rule that would need
# tightening later. No inbound rules of its own (ECS tasks don't need to
# accept inbound traffic directly — the ALB does, on a separate SG added
# alongside the core-api service module); outbound is unrestricted so tasks
# can reach RDS/Redis/external vendor APIs.
resource "aws_security_group" "app_tier" {
  name        = "${local.name_prefix}-app-tier-sg"
  description = "Attached to every ECS task in this environment"
  vpc_id      = module.networking.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, { Name = "${local.name_prefix}-app-tier-sg" })
}

module "database" {
  source = "../../modules/database"

  name_prefix                = local.name_prefix
  vpc_id                     = module.networking.vpc_id
  private_subnet_ids         = module.networking.private_subnet_ids
  allowed_security_group_ids = [aws_security_group.app_tier.id]

  # Staging sizing — smaller than production per docs/09-cost-analysis.md's
  # infra baseline table (100-500 calls/day tier).
  instance_class         = "db.t4g.small"
  allocated_storage_gb   = 20
  multi_az                = true
  backup_retention_days  = 7
  deletion_protection    = false # staging only — production sets this true

  tags = local.common_tags
}

module "cache" {
  source = "../../modules/cache"

  name_prefix                = local.name_prefix
  vpc_id                     = module.networking.vpc_id
  private_subnet_ids         = module.networking.private_subnet_ids
  allowed_security_group_ids = [aws_security_group.app_tier.id]

  node_type = "cache.t4g.small"
  multi_az  = true

  tags = local.common_tags
}
