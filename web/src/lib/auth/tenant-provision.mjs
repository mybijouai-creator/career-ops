/**
 * tenant-provision.mjs — where a signed-in user's own career-ops root lives
 * on disk, and getting it seeded the first time they need it.
 *
 * Layout: {platformRoot()}/tenants/{userId}/ — one level below the platform
 * root (which itself resolves to /app in a real deployment), sibling to
 * _accounts.db. A user's own id (crypto.mjs's randomToken(16), 128 bits) is
 * the directory name — non-guessable, so a directory listing or an off-by-one
 * in a path check can't be used to enumerate or address another tenant.
 *
 * Seeding reuses docker-seed-root.sh — the EXACT script docker-entrypoint.sh
 * runs at container boot for the default /app root — rather than a second,
 * driftable Node reimplementation of the same copy rules. See that script for
 * the system/user layer mechanics.
 */
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { platformRoot } from "./platform-root.mjs";

const SEED_SCRIPT_CANDIDATES = [
  "/usr/local/bin/docker-seed-root.sh", // where the Dockerfile installs it
  path.join(process.cwd(), "docker-seed-root.sh"), // local dev, run from web/
];

function findSeedScript() {
  // The seed script is a POSIX shell script with a shebang — Windows has no
  // direct way to execute it (execFileSync would need an explicit `sh`
  // interpreter it may not have), and production is always the Linux Docker
  // image regardless. Treat Windows like "no /opt/career-ops": fall through
  // to the mkdir-only path below rather than fail every Windows dev/CI run.
  if (process.platform === "win32") return null;
  return SEED_SCRIPT_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

/** Absolute path to a tenant's own root, whether or not it has been seeded yet. */
export function tenantRootPath(userId) {
  if (!/^[a-f0-9]{32}$/.test(String(userId ?? ""))) {
    // Every real user id is a 32-hex-char randomToken(16). Anything else is
    // either a bug upstream or an attempt to walk the path out of tenants/ —
    // refuse rather than build a path from it either way.
    throw new Error(`tenantRootPath: not a valid user id: ${JSON.stringify(userId)}`);
  }
  return path.join(platformRoot(), "tenants", userId);
}

/**
 * Ensure a tenant's root exists and carries the current system files,
 * creating it on first call and refreshing the system layer (same rule the
 * boot-time seed follows: system overwritten every time, user layer created
 * once and never touched again) on every call after.
 *
 * Idempotent and safe to call on every request — docker-seed-root.sh is
 * itself idempotent by design (that's the whole point of the boot-time
 * re-seed), so this just pays a small `find`+`cp -a` cost per request rather
 * than needing its own "have I seeded this one already" bookkeeping. Cheap
 * enough at this scale; revisit if it ever isn't (Phase 4 candidate, not a
 * silent assumption).
 */
export function ensureTenantRoot(userId) {
  const root = tenantRootPath(userId);
  const script = findSeedScript();
  if (script) {
    try {
      execFileSync(script, [], { env: { ...process.env, CAREER_OPS_ROOT: root }, stdio: "pipe" });
      return root;
    } catch {
      // The script itself refuses when /opt/career-ops (its system-files
      // source) doesn't exist — true in any environment that isn't the real
      // Docker image, Linux/macOS dev included. Fall through to mkdir-only
      // below rather than take the request down over a seed that can only
      // ever succeed in production anyway.
    }
  }
  // No usable seed script, or it failed outside the real image: just make
  // sure the directory itself exists — enough to develop the request
  // plumbing against, not a substitute for the real seed.
  fs.mkdirSync(root, { recursive: true });
  return root;
}
