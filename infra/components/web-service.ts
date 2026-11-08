import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';

// Bundles everything whose selector/scaleTargetRef is 1:1 tied to this one
// Deployment — the shape most Helm "common" charts and Pulumi's own
// kubernetesx helpers use (Deployment+Service+HPA+PDB together). Namespace
// and Secret stay outside: a Namespace is shared by many services with its
// own lifecycle, and a Secret's lifecycle (who rotates it, whether it's
// swapped for an ExternalSecret later) is independent of this workload's.
export interface WebServiceArgs {
  namespace: pulumi.Input<string>;
  image: string;
  replicas: number;
  secretName: pulumi.Input<string>;
  // Plain, non-secret placeholders only — see infra/index.ts for why.
  env: Record<string, string>;
  // Drives strategy + both probes together — one flag, not three, because
  // they only make sense as a set, and Stage 6's demo needs to flip all
  // three at once (same component, `hardened: false`) to produce its
  // "broken" profile for comparison.
  hardened: boolean;
  // Reserved for later stages — no PDB/HPA created while these are unset.
  pdbMinAvailable?: number;
  hpa?: { minReplicas: number; maxReplicas: number; targetCpuPercent: number };
}

export class WebService extends pulumi.ComponentResource {
  constructor(
    name: string,
    args: WebServiceArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('nodejspro-ecom:index:WebService', name, {}, opts);

    const labels = { app: name };

    new k8s.apps.v1.Deployment(
      name,
      {
        metadata: { namespace: args.namespace, name, labels },
        spec: {
          // Once an HPA exists it sets this field directly, under its
          // own field manager — if Pulumi kept asserting a fixed value
          // here, the next `pulumi up` would fight the HPA's own
          // decision and revert whatever it scaled to. Omitting the key
          // (not even `undefined` passed as a concrete value) means
          // Pulumi's server-side apply never claims this field once an
          // HPA is attached.
          ...(args.hpa ? {} : { replicas: args.replicas }),
          selector: { matchLabels: labels },
          strategy: {
            type: 'RollingUpdate',
            rollingUpdate: args.hardened
              ? { maxUnavailable: 0, maxSurge: 1 }
              : { maxUnavailable: 1, maxSurge: 1 },
          },
          template: {
            metadata: { labels },
            spec: {
              // 20 (hardened) / 30 (default) are both comfortably bigger
              // than DRAIN_MS's default 5000ms — 20 is the deliberate,
              // named value a real drain needs, not Kubernetes' own
              // unexamined default of 30.
              terminationGracePeriodSeconds: args.hardened ? 20 : 30,
              containers: [
                {
                  name: 'api',
                  image: args.image,
                  // Loaded via `kind load docker-image`, never pulled from
                  // a registry — IfNotPresent avoids a pointless pull
                  // attempt that would just fail.
                  imagePullPolicy: 'IfNotPresent',
                  ports: [{ containerPort: 3000 }],
                  env: Object.entries(args.env).map(([envName, value]) => ({
                    name: envName,
                    value,
                  })),
                  envFrom: [{ secretRef: { name: args.secretName } }],
                  resources: {
                    requests: { cpu: '100m', memory: '48Mi' },
                    limits: { memory: '192Mi' },
                  },
                  // "Not ready yet" and "should be killed" are different
                  // questions on different paths — readinessProbe only
                  // pulls this pod out of rotation (no restart, no
                  // cascade); livenessProbe on the SAME path as readiness
                  // would turn a temporary not-ready state into an
                  // infinite restart loop.
                  ...(args.hardened
                    ? {
                        readinessProbe: {
                          httpGet: { path: '/readyz', port: 3000 },
                          periodSeconds: 1,
                          failureThreshold: 1,
                        },
                        livenessProbe: {
                          httpGet: { path: '/healthz', port: 3000 },
                          initialDelaySeconds: 15,
                          periodSeconds: 10,
                          failureThreshold: 3,
                        },
                      }
                    : {}),
                },
              ],
            },
          },
        },
      },
      { parent: this },
    );

    new k8s.core.v1.Service(
      name,
      {
        metadata: { namespace: args.namespace, name, labels },
        spec: {
          type: 'NodePort',
          selector: labels,
          // 30080 matches k8s/kind-config.yaml's reserved extraPortMappings.
          ports: [{ port: 80, targetPort: 3000, nodePort: 30080 }],
        },
      },
      { parent: this },
    );

    // Guards voluntary disruptions outside the Deployment's own control
    // (kubectl drain, a node scale-down) — maxUnavailable above only
    // governs rollouts the Deployment controller itself drives. Only
    // enforced through the real Eviction API, never a plain delete.
    if (args.pdbMinAvailable) {
      new k8s.policy.v1.PodDisruptionBudget(
        name,
        {
          metadata: { namespace: args.namespace, name },
          spec: {
            minAvailable: args.pdbMinAvailable,
            selector: { matchLabels: labels },
          },
        },
        { parent: this },
      );
    }

    if (args.hpa) {
      new k8s.autoscaling.v2.HorizontalPodAutoscaler(
        name,
        {
          metadata: { namespace: args.namespace, name },
          spec: {
            scaleTargetRef: {
              apiVersion: 'apps/v1',
              kind: 'Deployment',
              name,
            },
            minReplicas: args.hpa.minReplicas,
            maxReplicas: args.hpa.maxReplicas,
            metrics: [
              {
                type: 'Resource',
                resource: {
                  name: 'cpu',
                  target: {
                    type: 'Utilization',
                    averageUtilization: args.hpa.targetCpuPercent,
                  },
                },
              },
            ],
            // Kubernetes' own default is 5 minutes, there specifically
            // to prevent production traffic from flapping-driven
            // instability — a concern that doesn't apply to this
            // dev-only stack (nothing real depends on it, and the cost
            // of reacting faster here is zero). 30s is a deliberate,
            // permanent choice for *this* stack, the way a real
            // per-environment values file would set it — not a demo-only
            // override. Production environments should keep the 5-minute
            // default.
            behavior: {
              scaleDown: { stabilizationWindowSeconds: 30 },
            },
          },
        },
        { parent: this },
      );
    }
  }
}
