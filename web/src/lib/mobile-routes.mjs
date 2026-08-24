/**
 * mobile-routes.mjs — the mobile navigation model from the PWA prototype.
 *
 * Three things the mobile chrome needs and the desktop sidebar does not:
 *
 *   1. A TITLE and SUBTITLE per route. The prototype's header carries the
 *      surface's name plus one line of orientation ("nine canonical states · 12
 *      roles"), which is where the mobile app explains itself — there is no
 *      sidebar to give context.
 *   2. A TAB per route. The bottom bar has five items but the app has more than
 *      five surfaces, so a detail route has to light up the tab it belongs
 *      under: a role eval lights Explore, an apply gate lights Today.
 *   3. A PARENT per route, for the back chevron. The prototype keeps a real
 *      navigation stack; a browser back button is not a substitute when the app
 *      is launched standalone straight onto a detail route from a notification.
 *
 * Plain .mjs with no React so `node --test` can assert the map stays total: a
 * route added to NAV_ITEMS with no entry here would otherwise get a blank
 * header and no active tab, which reads as a broken app rather than a missing
 * table row.
 */

/** The five bottom-bar tabs, in order. The only global navigation on mobile. */
export const MOBILE_TABS = [
  { id: "today", href: "/", label: "Today" },
  { id: "explore", href: "/explore", label: "Explore" },
  { id: "agent", href: "/agent", label: "Agent" },
  { id: "pipeline", href: "/pipeline", label: "Pipeline" },
  { id: "analytics", href: "/analytics", label: "Stats" },
];

/**
 * Route → { title, subtitle, tab, parent }.
 *
 * `parent: null` means a tab root: no back chevron, because backing out of a
 * root is what the tab bar is for. Subtitles are static orientation text, never
 * a number this table would have to keep true — a count that goes stale in a
 * header is worse than no count.
 */
export const MOBILE_ROUTES = {
  "/": { title: "Today", subtitle: "your decision queue", tab: "today", parent: null },
  "/explore": { title: "Explore", subtitle: "zero-token discovery · triage before you spend", tab: "explore", parent: null },
  "/agent": { title: "Agent", subtitle: "natural language in, components out", tab: "agent", parent: null },
  "/pipeline": { title: "Pipeline", subtitle: "canonical states from templates/states.yml", tab: "pipeline", parent: null },
  "/analytics": { title: "Analytics", subtitle: "does the filter actually work?", tab: "analytics", parent: null },

  // Detail and secondary surfaces: each lights the tab it lives under and backs
  // out to it.
  "/jobs": { title: "Evaluations", subtitle: "scored roles · blocks A–H", tab: "explore", parent: "/explore" },
  "/apply": { title: "Apply", subtitle: "gate + prefill · submit is human-only", tab: "today", parent: "/" },
  "/followups": { title: "Outreach", subtitle: "the agent drafts, you send", tab: "pipeline", parent: "/pipeline" },
  "/prep": { title: "Interviews", subtitle: "loop plans, story bank, gaps", tab: "pipeline", parent: "/pipeline" },
  "/portals": { title: "Portals", subtitle: "scan targets · zero tokens", tab: "explore", parent: "/explore" },
  "/cv": { title: "CV", subtitle: "cv.md is the source of truth", tab: "today", parent: "/config" },
  "/config": { title: "Settings", subtitle: "profile, autonomy, offline", tab: "today", parent: "/" },
  "/offline": { title: "Offline", subtitle: "nothing cached for this route yet", tab: "today", parent: "/" },
};

const FALLBACK = { title: "career-ops", subtitle: "", tab: "today", parent: "/" };

/**
 * Resolve a pathname to its route entry, longest-prefix first so `/jobs/247`
 * resolves through `/jobs` rather than falling back.
 *
 * Dynamic detail routes (`/jobs/247`, `/pipeline/12`) get their parent rewritten
 * to the LIST route rather than the table's static parent, so backing out of one
 * role lands on the list of roles instead of skipping a level.
 */
export function routeMeta(pathname) {
  const path = normalize(pathname);
  if (MOBILE_ROUTES[path]) return { ...MOBILE_ROUTES[path], path };

  const base = Object.keys(MOBILE_ROUTES)
    .filter((r) => r !== "/" && (path === r || path.startsWith(r + "/")))
    .sort((a, b) => b.length - a.length)[0];

  if (!base) return { ...FALLBACK, path };
  // A detail page under a list: back goes to the list.
  return { ...MOBILE_ROUTES[base], parent: base, path };
}

/** Which bottom-bar tab is lit for a pathname. */
export function activeTab(pathname) {
  return routeMeta(pathname).tab;
}

/** Whether the header shows a back chevron. */
export function hasParent(pathname) {
  return routeMeta(pathname).parent !== null;
}

function normalize(pathname) {
  if (typeof pathname !== "string" || pathname === "") return "/";
  // Drop a trailing slash (except the root) and any query/hash the caller left on.
  const clean = pathname.split(/[?#]/)[0];
  return clean.length > 1 && clean.endsWith("/") ? clean.slice(0, -1) : clean;
}
