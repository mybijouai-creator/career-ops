#!/bin/sh
# docker-seed-root.sh — the actual seeding logic, factored out of
# docker-entrypoint.sh so it can run MORE than once per container lifetime:
# once at boot (for the default root), and again on demand whenever a new
# tenant needs their own root provisioned (web/src/lib/auth/tenant-provision.mjs
# invokes this exact script as a subprocess, pointed at that tenant's
# directory via CAREER_OPS_ROOT — never a second, drifting reimplementation
# of the same copy/seed rules in Node).
#
# Deliberately does NOT `exec` anything — that's the one line
# docker-entrypoint.sh keeps for itself, since only the boot-time call should
# ever replace the container's own process.
#
# See docker-entrypoint.sh for the full system/user layer rationale; this file
# only contains the mechanism, not the "why".
set -eu

CORE=/opt/career-ops
ROOT=${CAREER_OPS_ROOT:-/app}

SYSTEM_PATHS="modes templates lib utils providers scripts fonts package.json tracker-aliases.json VERSION"
USER_DIRS="data reports output jds interview-prep documents config writing-samples batch"

log() { printf '[seed-root] %s\n' "$1"; }

if [ ! -d "$CORE" ]; then
  log "FATAL: $CORE is missing — the image is malformed."
  exit 1
fi

mkdir -p "$ROOT"

# ── System layer: overwrite ──────────────────────────────────────────────────
log "refreshing system files in $ROOT"
find "$CORE" -maxdepth 1 -name '*.mjs' -exec cp -a {} "$ROOT/" \;

ln -sfn "$CORE/node_modules" "$ROOT/node_modules"

for p in $SYSTEM_PATHS; do
  [ -e "$CORE/$p" ] || continue
  if [ -d "$CORE/$p" ]; then
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

if [ ! -f "$ROOT/data/applications.md" ]; then
  log "seeding data/applications.md"
  {
    printf '# Applications Tracker\n\n'
    printf '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n'
    printf '|---|------|---------|------|-------|--------|-----|--------|-------|\n'
  } > "$ROOT/data/applications.md"
fi

if [ ! -f "$ROOT/portals.yml" ] && [ -f "$ROOT/templates/portals.example.yml" ]; then
  log "seeding portals.yml from the example"
  cp -a "$ROOT/templates/portals.example.yml" "$ROOT/portals.yml"
fi

# cv.md and config/profile.yml are deliberately NOT seeded — see
# docker-entrypoint.sh's comment on why an empty placeholder is worse than
# letting onboarding detect them as missing.

log "seeded $ROOT"
