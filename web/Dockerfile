# ─────────────────────────────────────────────────────────────────────────────
# Production image for the career-ops WEB app (Coolify / any Docker host).
#
# This is NOT the repo's root Dockerfile. That one is a developer sandbox: it
# bind-mounts the sources and its command is `tail -f /dev/null`, so an image
# built from it contains no application code and runs no server — it can never
# be deployed. This file builds a real, self-contained server.
#
# BUILD CONTEXT IS THE REPO ROOT, not web/:
#     docker build -f web/Dockerfile -t career-ops-web .
# The web app orchestrates the core's own scripts (scan.mjs, set-status.mjs,
# merge-tracker.mjs …) by spawning them, so the image needs the whole checkout.
#
# Layout, and the reason for it:
#     /opt/career-ops   the image's copy of the core + the web server. CODE.
#     /app              the live career-ops root. A VOLUME. Seeded from
#                       /opt/career-ops on boot by docker-entrypoint.sh.
#
# career-ops stores state in files — data/applications.md IS the tracker — so
# the root must be a volume or a redeploy wipes the pipeline. But the root also
# holds the code, and a volume mounted over it would hide the image's copy.
# Hence the two directories and the entrypoint that reconciles them: system
# files refresh from the image every boot, user files are created once and never
# overwritten. See docker-entrypoint.sh for the full rationale.
# ─────────────────────────────────────────────────────────────────────────────

# Pinned to the playwright-core version in web/package.json. A mismatch is
# silent at build time and fails at the first PDF render, because playwright-core
# looks for one exact browser revision under PLAYWRIGHT_BROWSERS_PATH.
ARG PLAYWRIGHT_VERSION=1.62.0
# Node 22: web/package.json requires >=22.
ARG NODE_VERSION=22-bookworm-slim

# ── Stage 1: build the Next app ──────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /build

# Deps in their own layer, so a source-only change does not reinstall them.
COPY web/package.json web/package-lock.json ./web/
RUN --mount=type=cache,target=/root/.npm \
    cd web && npm ci --no-audit --no-fund

# The build needs the parent checkout present: route handlers import from ../,
# and next.config.mjs pins turbopack's root relative to web/.
#
# No package-lock.json here: the root one is deliberately gitignored (only
# web/package-lock.json is committed — see .gitignore), so a fresh clone never
# has it. This COPY is for the checkout's presence, not an install.
COPY package.json ./
COPY web/ ./web/

# A real directory during the build so pages that stat the checkout don't throw.
# No user data is read: every page touching it is force-dynamic (request time).
ENV NEXT_TELEMETRY_DISABLED=1 \
    CAREER_OPS_ROOT=/build
RUN cd web && npm run build

# ── Stage 2: the core's runtime deps ─────────────────────────────────────────
# The root scripts need js-yaml and dotenv. Installed separately so the runtime
# stage carries these and nothing else from the root package.
FROM node:${NODE_VERSION} AS core-deps
WORKDIR /core
# `npm install`, not `npm ci`: the root package-lock.json is deliberately
# gitignored (only web/package-lock.json is committed), so a fresh clone has no
# lockfile for `ci` to require. The root package.json's dependency list is small
# and unpinned by design; `install` is the correct tool for that shape.
COPY package.json ./
# --ignore-scripts: the root postinstall runs `playwright install`, which would
# fetch a second browser to the wrong place. Chromium is installed once below,
# at the pinned version.
RUN --mount=type=cache,target=/root/.npm \
    npm install --omit=dev --no-audit --no-fund --ignore-scripts

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runtime
ARG PLAYWRIGHT_VERSION

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    CAREER_OPS_ROOT=/app \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# git: update-system.mjs and some tracker tooling shell out to it.
# ca-certificates: outbound HTTPS to the ATS boards the scanner reads.
# tini: PID 1, so an agent CLI that outlives its request is reaped.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl git tini; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

# Chromium for PDF rendering, at the revision playwright-core expects.
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium \
 && rm -rf /root/.npm

# The agent CLI the app spawns for evaluations, CV tailoring and the agent
# console. clis.ts locates it by walking PATH, so a global install is enough.
# To use a different CLI, add it here — web/DEPLOY.md lists the supported ones.
RUN npm install -g --no-audit --no-fund @anthropic-ai/claude-code \
 && rm -rf /root/.npm

# ── The image's copy of the project: code only, never written at runtime ──
WORKDIR /opt/career-ops

COPY --chown=node:node package.json tracker-aliases.json VERSION ./
COPY --from=core-deps --chown=node:node /core/node_modules ./node_modules
COPY --chown=node:node *.mjs ./
COPY --chown=node:node modes/ ./modes/
COPY --chown=node:node templates/ ./templates/
COPY --chown=node:node lib/ ./lib/
COPY --chown=node:node utils/ ./utils/
COPY --chown=node:node providers/ ./providers/
COPY --chown=node:node scripts/ ./scripts/
COPY --chown=node:node fonts/ ./fonts/

# The web server: Next's standalone bundle. `public/` ships inside standalone;
# `.next/static` does not and must be copied explicitly (documented Next
# behaviour, not an oversight).
COPY --from=builder --chown=node:node /build/web/.next/standalone/ ./web/
COPY --from=builder --chown=node:node /build/web/.next/static ./web/.next/static

COPY --chown=node:node web/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# The volume's mount point, pre-created and owned so a fresh named volume is
# writable by `node` with no runtime chown.
RUN mkdir -p /app && chown node:node /app

USER node
EXPOSE 3000
VOLUME ["/app"]

# Loopback, which the origin guard always allows — CAREER_OPS_WEB_ALLOWED_HOSTS
# governs browser traffic and never this probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/version || exit 1

# tini reaps the spawned CLIs; the entrypoint seeds /app, then execs the server.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
# cwd is the standalone dir, so server.js resolves .next/ and public/ beside
# itself. CAREER_OPS_ROOT (=/app) is what points the app at the volume — the
# cwd/.. inference in careerOpsRoot() would be wrong for a standalone bundle.
CMD ["sh", "-c", "cd /opt/career-ops/web && exec node server.js"]
