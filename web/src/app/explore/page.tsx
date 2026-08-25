import fs from "node:fs";
import { ExplorerView } from "@/components/explore/explorer-view";
import { seedExploreFilters } from "@/lib/core/portals";
import { readInbox, readApplications, careerOpsRoot } from "@/lib/career-ops";
import { DEFAULT_FILTERS } from "@/lib/explore";
import { withTenantPage } from "@/lib/auth/with-tenant-page";

// Read live data at request time so a bare checkout (or `next build` with no
// CAREER_OPS_ROOT) never fails — discovery seeds are best-effort.
export const dynamic = "force-dynamic";

export default async function ExplorePage() {
  return withTenantPage(() => {
    let seed: { filters: typeof DEFAULT_FILTERS; seededFrom: string[] } = { filters: DEFAULT_FILTERS, seededFrom: [] };
    try {
      seed = seedExploreFilters();
    } catch {
      /* bare checkout → defaults */
    }
    let rootExists = false;
    try {
      rootExists = fs.existsSync(careerOpsRoot());
    } catch {
      /* ignore */
    }
    return (
      <ExplorerView seed={seed} inboxSnapshot={readInbox()} appsSnapshot={readApplications()} rootExists={rootExists} />
    );
  });
}
