# ---- Build Stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Production Stage ----
FROM node:22-alpine
RUN apk add --no-cache tini \
    # npm/npx are only needed at build time (npm ci ran in the builder) — the
    # runtime only executes `node server.js`. Removing npm drops bundled
    # transitive CVEs (e.g. node-tar, sigstore, brace-expansion inside
    # usr/local/lib/node_modules/npm) from the Trivy surface and shrinks the image.
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

# Non-root user. The whole app dir is made writable so winston can create
# /app/logs and the app can create the database file. /app/data is the named
# volume mount point — a fresh volume inherits its ownership, so it must
# already exist and belong to appuser.
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -s /bin/sh -D appuser \
    && mkdir -p /app/data && chown -R appuser:appgroup /app /app/data
USER appuser

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q --spider http://localhost:3001/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
