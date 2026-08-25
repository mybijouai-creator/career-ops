#!/bin/sh
# career-ops web — container entrypoint.
#
# career-ops keeps its state in FILES, not a database: data/applications.md is
# the tracker, reports/ holds the evaluations, cv.md is the CV. The whole
# career-ops root therefore has to live on a volume, or a redeploy resets the
# user's pipeline.
#
# But that root also contains the CODE (scan.mjs, modes/, templates/), and a
# volume mounted over it would hide whatever the image shipped. So:
#
#     /opt/career-ops   the image's copy — code, replaced on every deploy
#     /app              the volume — the live root the app actually reads
#
# On boot we seed /app from the image, then keep the two layers apart exactly as
# DATA_CONTRACT.md defines them:
#
#   SYSTEM layer  — refreshed from the image on EVERY boot, so deploying a new
#                   image actually updates the code. Safe to overwrite: the
#                   contract says user data never lives here.
#   USER layer    — created if absent, then never touched again. This is the
#                   half that must survive a deploy.
#
# Why copy rather than symlink each file: every user-layer write goes through
# atomicWrite(), which writes a temp file and renames it over the target. A
# rename REPLACES a symlink with a regular file, so a symlinked cv.md would
# silently stop being persisted the first time the CV was saved. Copying has no
# such trapdoor.
#
# The actual seeding mechanics live in docker-seed-root.sh, not here — it's
# the same script the app calls again at runtime to provision a new tenant's
# own root (web/src/lib/auth/tenant-provision.mjs), pointed at their directory
# via CAREER_OPS_ROOT instead of the default /app. One seeding implementation,
# invoked twice, rather than a second copy that can drift from this one.
set -eu

/usr/local/bin/docker-seed-root.sh

log() { printf '[entrypoint] %s\n' "$1"; }

# Note for operators: in a container, `update-system.mjs apply` is the wrong
# update path — it would rewrite /app's system files, which docker-seed-root.sh
# overwrites from the image on the next boot anyway. Deploy a new image instead.

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  log "note: ANTHROPIC_API_KEY is unset — evaluations and CV tailoring will fail;"
  log "      read-only surfaces (Today, Pipeline, Analytics, reports) still work."
fi

if [ -z "${CAREER_OPS_WEB_ALLOWED_HOSTS:-}" ]; then
  log "WARNING: CAREER_OPS_WEB_ALLOWED_HOSTS is unset. The origin guard serves"
  log "         loopback only, so every /api call from a browser will 403 and the"
  log "         app will look broken. Set it to your domain."
fi

log "starting: $*"
exec "$@"
