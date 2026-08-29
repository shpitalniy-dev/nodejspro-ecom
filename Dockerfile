FROM node:24-slim AS base
WORKDIR /app
COPY package*.json ./
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

FROM base AS deps
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM deps AS builder
COPY . .
RUN npm run build

FROM base AS runner
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
ENV NODE_ENV=production
USER node
COPY --from=builder /app/build ./build
COPY --from=builder /app/openapi ./openapi
CMD ["node", "./build/index.js"]
