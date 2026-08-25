import { assembleDedupContext } from "@/lib/core/discover";
import { withTenantHandler } from "@/lib/auth/with-tenant.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The client fetches this once before opening the AI stream and uses the set as a
// silent dedup backstop in the envelope parser (drops any AI candidate whose URL
// is already known). Keeps the stream itself pure text/plain.
export const GET = withTenantHandler(async () => {
  try {
    const { urls } = assembleDedupContext();
    return Response.json({ urls: [...urls] });
  } catch {
    return Response.json({ urls: [] });
  }
});
