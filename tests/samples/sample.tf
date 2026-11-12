# HCL / Terraform sample for Treelights tests.
variable "region" {
  type    = string
  default = "us-east-1"
}

resource "aws_s3_bucket" "logs" {
  bucket = "scan-logs-${var.region}"
  tags   = { Team = "blue", Retain = true }
  count  = length(var.ports) > 0 ? 1 : 0
}
