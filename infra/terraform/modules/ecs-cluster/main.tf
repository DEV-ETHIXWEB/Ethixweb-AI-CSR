# ECS Fargate cluster shell — per docs/01-architecture-overview.md §9 and
# docs/20-architecture-decision-records.md ADR-006 (Fargate for Phase 1-2,
# EKS deferred to an evidence-based trigger). This module provisions the
# cluster and its Fargate capacity providers only — individual services
# (core-api, voice-orchestrator, workers) are separate modules added once
# their container images exist (docs/13-implementation-backlog.md), since a
# task definition referencing a nonexistent ECR image isn't real,
# deployable infrastructure, just a placeholder.

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

variable "tags" {
  type    = map(string)
  default = {}
}

resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name

  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  # Baseline on-demand Fargate for predictable latency-sensitive workloads
  # (voice-orchestrator); FARGATE_SPOT weight is intentionally 0 by default
  # here — spot interruption during an active call is unacceptable, so
  # spot capacity is opted into per-service only for genuinely
  # interruption-tolerant workloads (e.g. batch/worker tasks), not set as a
  # cluster-wide default.
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 100
    base              = 1
  }
}

# Container image repositories — one per deployable service. Created here
# (cheap, no dependency on the image existing yet) so `docker push` has
# somewhere to go the moment a service's first image is built.
resource "aws_ecr_repository" "core_api" {
  name                 = "${var.name_prefix}-core-api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

resource "aws_ecr_repository" "voice_orchestrator" {
  name                 = "${var.name_prefix}-voice-orchestrator"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "retain_last_90_days" {
  for_each   = { core_api = aws_ecr_repository.core_api.name, voice_orchestrator = aws_ecr_repository.voice_orchestrator.name }
  repository = each.value

  # Matches the 90-day image retention policy stated in
  # docs/10-deployment-cicd.md §4 (rollback depends on the previous
  # known-good image still being in ECR).
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire images older than 90 days"
      selection = {
        tagStatus   = "any"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 90
      }
      action = { type = "expire" }
    }]
  })
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.main.arn
}

output "core_api_repository_url" {
  value = aws_ecr_repository.core_api.repository_url
}

output "voice_orchestrator_repository_url" {
  value = aws_ecr_repository.voice_orchestrator.repository_url
}
