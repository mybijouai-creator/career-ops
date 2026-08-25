/**
 * session.mjs — reading/writing the session cookie on plain Request/Response
 * objects (this app's route handlers use the Web-standard Request/Response,
 * not next/headers' cookies() helper — see /api/profile/route.ts for the
 * same convention).
 */
import { createSession, findSessionUser, deleteSession } from "./db.mjs";

export const SESSION_COOKIE = "career-ops-session";
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

/** Read the session cookie value from a request's Cookie header, if present. */
export function readSessionToken(req) {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Resolve the authenticated user for a request, or null. */
export function getSessionUser(req) {
  return findSessionUser(readSessionToken(req));
}

// HttpOnly (unreachable to page JS, so an XSS can't exfiltrate it directly) +
// SameSite=Lax (sent on top-level navigation, not on a cross-site POST — CSRF
// is additionally handled at the proxy layer by origin-guard.mjs) + Secure
// only in production (a plain-http localhost dev server still needs to work).
function cookieAttrs(maxAgeSeconds) {
  const parts = [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

/** Set-Cookie header value that logs a user in for THIRTY_DAYS_S. */
export function loginCookie(userId) {
  const token = createSession(userId);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttrs(THIRTY_DAYS_S)}`;
}

/** Set-Cookie header value that clears the session, both client-side (Max-Age=0)
 *  and server-side (the token row is deleted so it can't be replayed even if
 *  a client somehow still held onto it). */
export function logoutCookie(req) {
  const token = readSessionToken(req);
  if (token) deleteSession(token);
  return `${SESSION_COOKIE}=; ${cookieAttrs(0)}`;
}
