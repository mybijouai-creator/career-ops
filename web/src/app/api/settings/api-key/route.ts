import { getSessionUser } from "@/lib/auth/session.mjs";
import { setApiKey, getApiKeyInfo, deleteApiKey } from "@/lib/auth/db.mjs";
import { getMasterKey } from "@/lib/auth/crypto.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS = new Set(["anthropic", "openai", "google", "openrouter"]);

/** getMasterKey() throws if CAREER_OPS_ENCRYPTION_KEY isn't set — which is
 *  the correct state for a single-tenant deployment that never touches this
 *  route. Surface that as a clear 500 rather than an unhandled crash. */
function masterKeyOr500(): { key: Buffer } | { error: Response } {
  try {
    return { key: getMasterKey() };
  } catch (e) {
    return {
      error: Response.json(
        { error: e instanceof Error ? e.message : "CAREER_OPS_ENCRYPTION_KEY is not configured on this deployment." },
        { status: 500 },
      ),
    };
  }
}

export async function GET(req: Request) {
  const user = getSessionUser(req);
  if (!user) return Response.json({ error: "not authenticated" }, { status: 401 });
  const mk = masterKeyOr500();
  if ("error" in mk) return mk.error;
  return Response.json(getApiKeyInfo(user.id, mk.key));
}

export async function PUT(req: Request) {
  const user = getSessionUser(req);
  if (!user) return Response.json({ error: "not authenticated" }, { status: 401 });
  const mk = masterKeyOr500();
  if ("error" in mk) return mk.error;

  let body: { provider?: unknown; apiKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const provider = typeof body.provider === "string" ? body.provider : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (!PROVIDERS.has(provider)) return Response.json({ error: `provider must be one of: ${[...PROVIDERS].join(", ")}` }, { status: 400 });
  if (!apiKey) return Response.json({ error: "apiKey is required" }, { status: 400 });
  // No real provider key is anywhere near this long — a generous ceiling that
  // still stops an authenticated request from stuffing an arbitrarily large
  // blob into the encrypted-at-rest column.
  if (apiKey.length > 2000) return Response.json({ error: "apiKey is too long" }, { status: 400 });

  setApiKey(user.id, provider, apiKey, mk.key);
  return Response.json(getApiKeyInfo(user.id, mk.key));
}

export async function DELETE(req: Request) {
  const user = getSessionUser(req);
  if (!user) return Response.json({ error: "not authenticated" }, { status: 401 });
  deleteApiKey(user.id);
  return Response.json({ ok: true });
}
