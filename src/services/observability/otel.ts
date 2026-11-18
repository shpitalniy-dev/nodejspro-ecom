// Side-effect module: starts the OpenTelemetry SDK the moment it's
// imported. Loaded via Node's --import flag (package.json's start/
// start:vault/demo:* scripts), not a plain first-line import — this
// repo's own eslint-plugin-simple-import-sort would happily reorder a
// "just import it first" convention the next time anyone runs
// `eslint --fix`, silently breaking instrumentation with no error. --import
// runs before the entry module's own import graph is even resolved, so
// ordering isn't a question.
//
// No explicit config beyond serviceName: NodeSDK otherwise reads OTEL_*
// env vars itself (OTEL_EXPORTER_OTLP_ENDPOINT, ...) — the same
// vault-sourced values criterion 9 already requires, nothing hardcoded
// here. If OTEL_EXPORTER_OTLP_ENDPOINT isn't set (e.g. the observability
// stack isn't up), this exports into the void and fails silently in the
// background — never crashes the app, by design of the OTLP exporter.
//
// sdk is exported for otel-shutdown.service.ts, the only other thing
// allowed to touch it — everything else reaches OTel through
// @opentelemetry/api (trace.getActiveSpan(), etc.), never this instance.
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { NodeSDK } from '@opentelemetry/sdk-node';

export const sdk = new NodeSDK({
  // A real default rather than an unnamed service in Tempo/Grafana —
  // still overridable (OTEL_SERVICE_NAME, read here rather than left to
  // NodeSDK's own fallback, so there's one visible place this comes from).
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'nodejspro-ecom-api',
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disabled: this would inject trace_id/span_id into every pino line
      // a second time, via a different mechanism than logger.service.ts's
      // own explicit mixin (which already does exactly this, visibly, in
      // one place) — redundant at best, a second thing to keep in sync at
      // worst.
      '@opentelemetry/instrumentation-pino': { enabled: false },
    }),
  ],
});

sdk.start();
