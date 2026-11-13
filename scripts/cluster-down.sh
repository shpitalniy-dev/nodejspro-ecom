#!/usr/bin/env bash
#
# Tears down the local kind cluster for HW #28 only — never touches
# anything else running under Docker.
#
#   bash scripts/cluster-down.sh
set -uo pipefail

kind delete cluster --name nodejspro-ecom
echo "free memory: $(docker run --rm alpine:3.20 free -m 2>/dev/null | awk '/^Mem:/{print $7}') MB"
