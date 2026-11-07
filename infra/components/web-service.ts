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
          replicas: args.replicas,
          selector: { matchLabels: labels },
          template: {
            metadata: { labels },
            spec: {
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
                    requests: { cpu: '20m', memory: '48Mi' },
                    limits: { memory: '192Mi' },
                  },
                },
              ],
            },
          },
          // No strategy/probes yet — added in a later stage. Defaults to
          // Kubernetes' own 25%/25% RollingUpdate, which is exactly the
          // "no readiness" profile the HW measures the fix against.
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

    // Later stage adds: if (args.pdbMinAvailable) new k8s.policy.v1.PodDisruptionBudget(...)
    // Later stage adds: if (args.hpa) new k8s.autoscaling.v2.HorizontalPodAutoscaler(...)
  }
}
