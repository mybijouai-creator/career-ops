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
set -eu

CORE=/opt/career-ops
ROOT=${CAREER_OPS_ROOT:-/app}

# System layer: image wins. Mirrors the file list in update-system.mjs — if you
# add a core script or mode directory, add it here or the deployed app will run
# the version from whenever the volume was first created.
SYSTEM_PATHS="modes templates lib utils providers scripts fonts package.json tracker-aliases.json VERSION"

# User layer: volume wins. Directories only; single files are handled below,
# because `mkdir -p` on a path the app expects to be a FILE (cv.md) would make
# the app report an unreadable CV rather than an absent one.
USER_DIRS="data reports output jds interview-prep documents config writing-samples batch"

log() { printf '[entrypoint] %s\n' "$1"; }

if [ ! -d "$CORE" ]; then
  log "FATAL: $CORE is missing — the image is malformed."
  exit 1
fi

mkdir -p "$ROOT"

# ── System layer: overwrite ──────────────────────────────────────────────────
# Root-level *.mjs first. Copied individually rather than with a glob against
# the volume so a script deleted upstream does not linger forever.
log "refreshing system files in $ROOT"
find "$CORE" -maxdepth 1 -name '*.mjs' -exec cp -a {} "$ROOT/" \;

# node_modules is the one system path that is SYMLINKED rather than copied: it
# is 21MB, it is never written by the app (the atomicWrite hazard above applies
# only to user-layer files), and duplicating it into the volume on every boot
# buys nothing. Node resolves a spawned script's requires by walking up from
# /app, so the link has to exist — it cannot simply be left out.
ln -sfn "$CORE/node_modules" "$ROOT/node_modules"

for p in $SYSTEM_PATHS; do
  [ -e "$CORE/$p" ] || continue
  if [ -d "$CORE/$p" ]; then
    # `modes/` is the awkward case: system modes live beside the USER-layer
    # _profile.md and _custom.md (DATA_CONTRACT.md). Copying the directory's
    # CONTENTS without --delete refreshes the system modes and leaves those two
    # in place; a plain `rm -rf && cp` would delete the user's targeting.
    mkdir -p "$ROOT/$p"
    cp -a "$CORE/$p/." "$ROOT/$p/"
  else
    cp -a "$CORE/$p" "$ROOT/$p"
  fi
done

# ── User layer: create once, never overwrite ─────────────────────────────────
for d in $USER_DIRS; do
  [ -d "$ROOT/$d" ] || { mkdir -p "$ROOT/$d"; log "created $d/"; }
done

# The tracker has to exist with its header row before merge-tracker.mjs will
# write to it. Seeded only when absent, so an existing pipeline is never touched.
if [ ! -f "$ROOT/data/applications.md" ]; then
  log "seeding data/applications.md"
  {
    printf '# Applications Tracker\n\n'
    printf '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
    printf '|---|------|---------|------|-------|--------|-----|--------|-------|\n'
  } > "$ROOT/data/applications.md"
fi

# portals.yml is user layer but ships an example. Seeding it means the scanner
# works on first boot instead of failing onboarding's step 3.
if [ ! -f "$ROOT/portals.yml" ] && [ -f "$ROOT/templates/portals.example.yml" ]; then
  log "seeding portals.yml from the example"
  cp -a "$ROOT/templates/portals.example.yml" "$ROOT/portals.yml"
fi

# cv.md and config/profile.yml are deliberately NOT seeded. The app's own
# onboarding detects them as missing and walks the user through creating them,
# which is a better first run than an empty placeholder that reads as done.

# Note for operators: in a container, `update-system.mjs apply` is the wrong
# update path — it would rewrite /app's system files, which this script
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
