#!/usr/bin/env bash
#
# Brings up the local kind cluster for HW #28 and loads the built image
# into it. kind over minikube because of this machine's own numbers, not
# taste — see README's ## Kubernetes section.
#
#   bash scripts/cluster-up.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CLUSTER=nodejspro-ecom
IMAGE=nodejspro-ecom-api:k8s

# Preflight: a real, previously-hit failure mode, not a hypothetical —
# kind create fails with "all predefined address pools have been fully
# subnetted" once Docker's network count gets too high. Warn and name the
# unused (zero-container) networks rather than pruning anything ourselves.
NETS=$(docker network ls -q | wc -l | tr -d ' ')
if [ "$NETS" -ge 28 ]; then
  echo "warning: $NETS docker networks exist; kind create may fail around ~31."
  echo "unused networks (0 containers), remove by name if needed:"
  docker network ls --format '{{.Name}}' | while read -r n; do
    [ "$(docker network inspect "$n" --format '{{len .Containers}}')" = "0" ] && echo "  docker network rm $n"
  done
fi

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "cluster $CLUSTER already up"
else
  time kind create cluster --name "$CLUSTER" --config k8s/kind-config.yaml
fi

kubectl --context "kind-$CLUSTER" wait --for=condition=Ready node --all --timeout=120s

docker image inspect "$IMAGE" >/dev/null 2>&1 || {
  echo "image $IMAGE not found — run \"npm run image:build\" first"
  exit 1
}
echo "loading $IMAGE into $CLUSTER"
kind load docker-image "$IMAGE" --name "$CLUSTER"

kubectl --context "kind-$CLUSTER" get nodes
