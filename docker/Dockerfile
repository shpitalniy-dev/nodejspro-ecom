FROM node:24-slim AS base
WORKDIR /app
COPY package*.json ./
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "var p = process.env.PORT || 3000; fetch('http://127.0.0.1:' + p + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

FROM base AS deps
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS builder
COPY . .
RUN npm run build

FROM base AS runner
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
ENV NODE_ENV=production
USER node
COPY .env.example ./.env.example
COPY --from=builder /app/build ./build
COPY --from=builder /app/openapi ./openapi
CMD ["node", "./build/index.js"]

# HW #28 — hardened image for the Kubernetes rollout demo. Branches off
# `base`/`runner`/`builder` above, which stay exactly as they were for
# docker-compose's `api`/`garage-init` services.

# No real private registry in this project, so this stage only proves a
# build-time secret is reachable via BuildKit's mount and never persisted
# in the image — it doesn't gate the real `npm ci`, which already ran
# against the public registry in `runner`. Referenced by `distroless`
# below via COPY --from, so BuildKit actually executes it (an unreferenced
# stage is simply skipped, which would make demo:image inspect an image
# that never touched the secret).
FROM base AS secret-demo
RUN --mount=type=secret,id=npmtoken \
    NPM_TOKEN="$(cat /run/secrets/npmtoken)" && test -n "$NPM_TOKEN" \
    && echo "token read, length ${#NPM_TOKEN}" \
    && touch /tmp/secret-ok

FROM gcr.io/distroless/nodejs24-debian12:nonroot AS distroless
WORKDIR /app
COPY --from=runner  /app/node_modules ./node_modules
COPY --from=builder /app/build        ./build
COPY --from=builder /app/openapi      ./openapi
COPY --from=secret-demo /tmp/secret-ok /tmp/secret-ok
# USER 65532, not USER nonroot: the base image's :nonroot tag sets a
# numeric uid under the hood, but writing the NAME here would make
# Kubernetes' runAsNonRoot check fail later (CreateContainerConfigError —
# kubelet doesn't resolve usernames). Numeric now avoids that fully.
USER 65532
# No "node" here — this base's ENTRYPOINT is already /nodejs/bin/node,
# so CMD is just its argument. CMD ["node", "build/index.js"] would run
# `node node build/index.js` and fail.
CMD ["build/index.js"]
# No HEALTHCHECK: distroless has no curl/wget to run one with. Kubernetes'
# own readiness/liveness probes (added in a later stage) replace it —
# an accepted, named cost of dropping the shell, not an oversight.
