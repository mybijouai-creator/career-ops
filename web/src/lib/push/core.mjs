/**
 * core.mjs — the notification vocabulary, and the rule about what a push may
 * carry (HANDOFF.md §7b).
 *
 * Four kinds, each mapping to a route so a notification action opens the right
 * surface:
 *
 *   | kind          | when                          | opens        |
 *   | gate_opened   | a run stopped to ask you      | /apply       |
 *   | worker_done   | a scheduled worker finished   | /            |
 *   | followup_due  | a follow-up came due          | /followups   |
 *   | posting_closed| a tracked posting went dead   | /pipeline    |
 *
 * The load-bearing rule, verbatim from the handoff: "Gate notifications carry no
 * diff content in the payload." A push payload sits in the OS notification
 * store, is rendered on a lock screen, and passes through a third-party push
 * service (FCM, Mozilla, Apple). A CV diff or a company name in that path leaks
 * the user's job search to a shoulder-surfer and to the push provider. So a gate
 * push says only that a gate is open; the diff is read from the app, over the
 * same-origin API, against live state.
 *
 * Pure — no crypto, no fs — so `node --test` can assert the redaction rule
 * directly rather than through a mocked push service.
 */

export const PUSH_KINDS = ["gate_opened", "worker_done", "followup_due", "posting_closed"];

/** kind → the route its primary action opens. */
export const KIND_ROUTE = {
  gate_opened: "/apply",
  worker_done: "/",
  followup_due: "/followups",
  posting_closed: "/pipeline",
};

/** Kinds whose payload must never name a company, a role or a diff. */
const CONFIDENTIAL_KINDS = new Set(["gate_opened"]);

/**
 * Build the payload that goes on the wire.
 *
 * For a confidential kind every caller-supplied detail is DROPPED rather than
 * trimmed or hashed — there is no safe amount of a CV diff to put on a lock
 * screen, and a partial leak is still a leak. The notification's whole job is to
 * get the user to open the app, which needs no detail at all.
 *
 * @param {{kind: string, title?: string, body?: string, tag?: string, url?: string, count?: number}} input
 * @returns {{kind: string, title: string, body: string, tag: string, url: string, actions: Array<{action: string, title: string}>}}
 */
export function buildPayload(input = {}) {
  const kind = PUSH_KINDS.includes(input.kind) ? input.kind : "worker_done";
  // `startsWith("/")` alone is not enough: "//evil.example.com" is a
  // PROTOCOL-RELATIVE url that navigates off-site, so accepting it would make a
  // notification action an open redirect out of the app.
  const url = isAppRelative(input.url) ? input.url : KIND_ROUTE[kind];

  if (CONFIDENTIAL_KINDS.has(kind)) {
    const n = Number.isInteger(input.count) && input.count > 1 ? input.count : 1;
    return {
      kind,
      // Deliberately generic. No company, no role, no score, no diff.
      title: n > 1 ? `${n} approvals waiting` : "An approval is waiting",
      body: "Open career-ops to review the diff before anything is written.",
      // A stable tag per kind, so a second gate REPLACES the first notification
      // instead of stacking — and so the count is the only thing that leaks.
      tag: kind,
      url,
      actions: [{ action: url, title: "Review" }],
    };
  }

  return {
    kind,
    title: str(input.title) || defaultTitle(kind),
    body: str(input.body),
    tag: str(input.tag) || kind,
    url,
    actions: [{ action: url, title: actionLabel(kind) }],
  };
}

/** A path inside this app: leading slash, and not protocol-relative. */
function isAppRelative(url) {
  return typeof url === "string" && url.startsWith("/") && !url.startsWith("//");
}

function str(v) {
  // Notification text is rendered by the OS, not by HTML, so the concern is
  // length and control characters rather than markup.
  return typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200) : "";
}

function defaultTitle(kind) {
  return {
    worker_done: "A background run finished",
    followup_due: "A follow-up is due",
    posting_closed: "A tracked posting closed",
  }[kind] ?? "career-ops";
}

function actionLabel(kind) {
  return { worker_done: "Open", followup_due: "Draft it", posting_closed: "Review" }[kind] ?? "Open";
}

/**
 * Is this a subscription object the push service will accept? Checked before
 * storing, so a malformed one cannot sit in the file failing on every send.
 */
export function isValidSubscription(sub) {
  if (!sub || typeof sub !== "object") return false;
  if (typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint)) return false;
  const keys = sub.keys;
  if (!keys || typeof keys !== "object") return false;
  return typeof keys.p256dh === "string" && keys.p256dh.length > 0 && typeof keys.auth === "string" && keys.auth.length > 0;
}

/** Endpoints are the subscription's identity — dedup and removal key on them. */
export function subscriptionId(sub) {
  return isValidSubscription(sub) ? sub.endpoint : null;
}

/**
 * Push-service status codes that mean the subscription is DEAD and should be
 * dropped rather than retried. 404/410 are the documented "gone" responses; a
 * 403/401 means our VAPID key no longer matches the one it was created with, so
 * retrying that endpoint forever is pointless too.
 */
export function isGoneStatus(status) {
  return status === 404 || status === 410 || status === 403 || status === 401;
}
