package policy.storage

import rego.v1

# Deny public storage buckets
default allow := false

deny contains msg if {
	some bucket in input.resources
	bucket.type == "storage_bucket"
	bucket.public == true
	msg := sprintf("bucket %s must not be public", [bucket.name])
}

allow if count(deny) == 0
