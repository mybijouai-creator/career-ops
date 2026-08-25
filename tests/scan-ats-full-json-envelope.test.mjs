// tests/scan-ats-full-json-envelope.test.mjs — a fatal, pre-completion exit
// in --json mode must still emit a valid JSON envelope on stdout (an
// {error, offers:[]} object), never leave stdout empty. Without this, the
// web caller (web/src/lib/core/scan.ts) can't tell "the scanner never ran"
// apart from "genuinely 0 matches" and falls back to a generic "no readable
// output" message that throws away the real reason.
//
// Runs the REAL script as a SUBPROCESS (not dynamic-imported) because the
// behavior under test is the script terminating itself + what lands on
// stdout right before that — dynamic-importing and calling the internal
// exitFatal() directly would take this whole in-process test runner down
// with it (test-all.mjs's own #1916 guard refuses any discovered suite that
// could do that; a subprocess is how this suite stays outside that risk).
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pass, fail, run, lastRunFailure, ROOT, NODE } from './helpers.mjs';

console.log('\nscan-ats-full --json: a fatal exit still emits a valid envelope');

const scriptPath = join(ROOT, 'scan-ats-full.mjs');

function runScanFatal(extraEnv) {
  // run() resolves with the child's stdout on a CLEAN exit, or null on any
  // non-zero exit — this script always exits 1 on the fatal path under test,
  // so the real stdout/stderr/status live on lastRunFailure() instead.
  run(NODE, [scriptPath, '--dry-run', '--since', '7', '--ats', 'greenhouse', '--limit', '5', '--json'], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    timeout: 15_000,
  });
  return lastRunFailure();
}

// Deterministic regardless of whether this checkout has a real portals.yml:
// point CAREER_OPS_PORTALS at a path that provably does not exist.
{
  const tmp = mkdtempSync(join(tmpdir(), 'scan-ats-full-envelope-'));
  const missingPortals = join(tmp, 'does-not-exist.yml');
  try {
    const failure = runScanFatal({ CAREER_OPS_PORTALS: missingPortals });
    if (!failure) {
      fail('scan-ats-full.mjs should have exited non-zero when portals.yml is missing');
    } else if (failure.status !== 1) {
      fail(`expected exit code 1, got ${failure.status} (signal: ${failure.signal})`);
    } else {
      let parsed = null;
      try {
        parsed = JSON.parse(failure.stdout.trim());
      } catch (e) {
        fail(`stdout did not parse as JSON on the fatal path: ${e.message}\nstdout was: ${JSON.stringify(failure.stdout)}`);
      }
      if (parsed) {
        if (typeof parsed.error === 'string' && /portals\.yml not found/.test(parsed.error) && Array.isArray(parsed.offers) && parsed.offers.length === 0) {
          pass('a fatal exit (missing portals.yml) still emits {error, offers:[]} on stdout, in --json mode');
        } else {
          fail(`fatal-path JSON envelope shape is wrong: ${JSON.stringify(parsed)}`);
        }
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Without --json, the human-readable path is unchanged: nothing is written
// to stdout on the same fatal condition (stdout stays reserved for --json
// mode only — this is a regression guard, not new behavior).
{
  const tmp = mkdtempSync(join(tmpdir(), 'scan-ats-full-envelope-legacy-'));
  const missingPortals = join(tmp, 'does-not-exist.yml');
  try {
    run(NODE, [scriptPath, '--dry-run', '--since', '7', '--ats', 'greenhouse', '--limit', '5'], {
      cwd: ROOT,
      env: { ...process.env, CAREER_OPS_PORTALS: missingPortals },
      timeout: 15_000,
    });
    const failure = lastRunFailure();
    if (!failure) {
      fail('scan-ats-full.mjs should have exited non-zero when portals.yml is missing (non-json path)');
    } else if (failure.stdout.trim()) {
      fail(`non-json mode should write nothing to stdout on this fatal path, got: ${JSON.stringify(failure.stdout)}`);
    } else {
      pass('the same fatal exit writes nothing to stdout when --json was not requested');
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
