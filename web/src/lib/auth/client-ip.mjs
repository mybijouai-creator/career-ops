/**
 * client-ip.mjs — best-effort caller IP for rate-limiting only, never for
 * anything security-load-bearing on its own (an IP header is client-supplied
 * and only as trustworthy as the reverse proxy in front of this app — see
 * origin-guard.mjs for the actual same-origin/loopback enforcement, which
 * does not depend on this at all).
 *
 * Behind Coolify/Traefik (this app's documented deployment target,
 * web/DEPLOY.md) the proxy sets X-Forwarded-For itself, so a client cannot
 * simply lie their way past the signup throttle by sending their own
 * X-Forwarded-For — the proxy's own hop is appended after (or replaces) it.
 * A raw, unproxied deployment where a client's own header IS the request's
 * only signal makes this a soft limit rather than a hard one; that is an
 * accepted tradeoff for a login/signup throttle, not a security boundary.
 */

/** First IP in a comma-separated X-Forwarded-For chain, or X-Real-IP, or "unknown". */
export function clientIp(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  return "unknown";
}
