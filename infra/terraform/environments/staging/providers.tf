terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — S3 backend with a DynamoDB lock table, per
  # docs/10-deployment-cicd.md §5 ("no manually-created infrastructure").
  # The bucket/table themselves are provisioned once, out-of-band, by the
  # very first `terraform apply` of a bootstrap config (not shown here —
  # a backend can't create the backend it depends on), then referenced here.
  backend "s3" {
    bucket         = "ethixweb-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "ethixweb-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}
