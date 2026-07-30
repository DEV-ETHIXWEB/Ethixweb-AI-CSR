variable "aws_region" {
  type    = string
  default = "us-east-1" # co-located with the voice vendor's nearest PoP — confirm against docs/02-voice-pipeline-and-telephony.md before Phase 1 go-live, per docs/00-INDEX.md's open sign-off item
}

variable "environment" {
  type    = string
  default = "staging"
}

locals {
  name_prefix = "ethixweb-${var.environment}"
  common_tags = {
    Project     = "ethixweb-ai-csr"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
