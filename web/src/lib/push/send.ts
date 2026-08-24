import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { careerOpsRoot } from "@/lib/career-ops";
import { buildPayload, isGoneStatus, isValidSubscription, subscriptionId } from "@/lib/push/core.mjs";

/**
 * send.ts — VAPID keys, the subscription store, and delivery.
 *
 * Uses `web-push` rather than a hand-rolled implementation. RFC 8291 payload
 * encryption is ECDH + HKDF + AES-128-GCM with an exact key-derivation order;
 * Node has all the primitives, and getting the order subtly wrong produces
 * payloads that decrypt on one browser and fail on another. That is not a good
 * place to save a dependency.
 */

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string }; addedAt: number; ua?: string };

function subsPath(): string {
  return path.join(careerOpsRoot(), "data", "push-subscriptions.json");
}

function vapidPath(): string {
  return path.join(careerOpsRoot(), "config", "vapid.json");
}

/**
 * The VAPID keypair, from the environment if provided, otherwise generated once
 * and kept in config/.
 *
 * Env wins so a deployment can inject the pair and keep the private key out of
 * the data volume. When it is generated instead, it lands in `config/` — user
 * layer, on the persistent volume — because a key that regenerated on every
 * restart would silently invalidate every existing subscription: the push
 * service rejects a payload signed by a key that does not match the one the
 * subscription was created with, and the user would just stop getting
 * notifications with nothing to see in the UI.
 *
 * The private key authorizes pushing to this user's own subscriptions and
 * nothing else. It is not an account credential.
 */
export function vapidKeys(): { publicKey: string; privateKey: string; subject: string } | null {
  const subject = process.env.CAREER_OPS_VAPID_SUBJECT?.trim() || "mailto:career-ops@localhost";
  const envPub = process.env.CAREER_OPS_VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.CAREER_OPS_VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv, subject };

  try {
    const raw = fs.readFileSync(vapidPath(), "utf8");
    const parsed = JSON.parse(raw) as { publicKey?: string; privateKey?: string };
    if (parsed.publicKey && parsed.privateKey) {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey, subject };
    }
  } catch {
    /* not generated yet */
  }

  try {
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(vapidPath()), { recursive: true });
    // 0600: it is a private key sitting in the user's data directory.
    fs.writeFileSync(vapidPath(), JSON.stringify(keys, null, 2), { encoding: "utf8", mode: 0o600 });
    return { ...keys, subject };
  } catch {
    // No writable config dir → push is simply unavailable. The UI reports that
    // rather than offering a subscribe button that cannot work.
    return null;
  }
}

function readSubs(): Subscription[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(subsPath(), "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isValidSubscription) : [];
  } catch {
    return [];
  }
}

function writeSubs(subs: Subscription[]): void {
  const file = subsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Temp-then-rename: the same discipline as the core's atomicWrite, so a crash
  // mid-write cannot truncate the file and lose every subscription.
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(subs, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function addSubscription(sub: unknown, ua?: string): { ok: boolean; reason?: string } {
  if (!isValidSubscription(sub)) return { ok: false, reason: "malformed subscription" };
  const s = sub as Subscription;
  const subs = readSubs();
  // The endpoint is the identity: re-subscribing the same browser must update,
  // not append, or every send fans out to duplicates of one device.
  const existing = subs.findIndex((x) => x.endpoint === s.endpoint);
  const record: Subscription = { endpoint: s.endpoint, keys: s.keys, addedAt: Date.now(), ua: ua?.slice(0, 200) };
  if (existing >= 0) subs[existing] = record;
  else subs.push(record);
  writeSubs(subs);
  return { ok: true };
}

export function removeSubscription(endpoint: string): void {
  writeSubs(readSubs().filter((s) => s.endpoint !== endpoint));
}

export function subscriptionCount(): number {
  return readSubs().length;
}

/**
 * Send a notification to every subscribed device.
 *
 * `buildPayload` is applied HERE, not by callers, so a caller that passes a
 * company name into a gate notification cannot leak it — the redaction is on the
 * only path to the wire.
 *
 * Dead subscriptions are pruned as they are discovered. A browser that cleared
 * its site data leaves an endpoint that returns 410 forever, and retrying it on
 * every send would eventually be the only thing this function does.
 */
export async function sendPush(input: {
  kind: string;
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
  count?: number;
}): Promise<{ sent: number; pruned: number; failed: number; reason?: string }> {
  const keys = vapidKeys();
  if (!keys) return { sent: 0, pruned: 0, failed: 0, reason: "no VAPID keys — push unavailable" };

  const subs = readSubs();
  if (subs.length === 0) return { sent: 0, pruned: 0, failed: 0, reason: "no subscriptions" };

  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  const payload = JSON.stringify(buildPayload(input));

  let sent = 0;
  let failed = 0;
  const gone: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 60 * 60 });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (typeof status === "number" && isGoneStatus(status)) gone.push(sub.endpoint);
        else failed++;
      }
    }),
  );

  if (gone.length > 0) writeSubs(readSubs().filter((s) => !gone.includes(s.endpoint)));
  return { sent, pruned: gone.length, failed };
}

/** Convenience for the gate store — carries no detail, by construction. */
export async function notifyGateOpened(count = 1) {
  return sendPush({ kind: "gate_opened", count });
}

export { subscriptionId };
