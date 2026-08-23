// The mobile chrome derives its header AND its active tab from one table. A
// route missing from that table gets a blank title and a dark tab bar, which
// reads as a broken app rather than a missing table row — so the totality check
// against NAV_ITEMS is the point of this file, not the individual lookups.
//
// Run:  node --test tests/lib/mobile-routes.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MOBILE_ROUTES, MOBILE_TABS, activeTab, hasParent, routeMeta } from "../../src/lib/mobile-routes.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("the bottom bar has exactly five tabs — the prototype's mobile nav rule", () => {
  assert.equal(MOBILE_TABS.length, 5);
  const ids = MOBILE_TABS.map((t) => t.id);
  assert.equal(new Set(ids).size, 5, "tab ids must be unique");
});

test("every tab root is in the route table and is its own tab", () => {
  for (const { id, href } of MOBILE_TABS) {
    const meta = MOBILE_ROUTES[href];
    assert.ok(meta, `tab ${id} points at ${href}, which has no route entry`);
    assert.equal(meta.tab, id, `${href} must light the ${id} tab`);
    assert.equal(meta.parent, null, `${href} is a tab root, so it must have no back target`);
  }
});

test("every route declares a tab that actually exists in the bar", () => {
  const ids = new Set(MOBILE_TABS.map((t) => t.id));
  for (const [route, meta] of Object.entries(MOBILE_ROUTES)) {
    assert.ok(ids.has(meta.tab), `${route} claims tab "${meta.tab}", which is not in the bar`);
  }
});

test("every desktop NAV_ITEMS destination has a mobile route entry", () => {
  // The two navs are allowed to differ in SHAPE but not in COVERAGE: anything
  // reachable on desktop must render a titled surface on mobile.
  const src = fs.readFileSync(path.join(ROOT, "src/lib/nav-items.ts"), "utf8");
  const hrefs = [...src.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 5, "failed to parse NAV_ITEMS — this guard would silently pass");
  for (const href of hrefs) {
    assert.ok(MOBILE_ROUTES[href], `${href} is in NAV_ITEMS but missing from MOBILE_ROUTES`);
  }
});

test("every route in the table has a real page on disk", () => {
  for (const route of Object.keys(MOBILE_ROUTES)) {
    const dir = route === "/" ? "src/app" : path.join("src/app", route);
    const hasPage = ["page.tsx", "page.ts", "page.jsx", "page.js"].some((f) =>
      fs.existsSync(path.join(ROOT, dir, f)),
    );
    assert.ok(hasPage, `${route} is in MOBILE_ROUTES but has no page under ${dir}`);
  }
});

test("every route has a non-empty title", () => {
  for (const [route, meta] of Object.entries(MOBILE_ROUTES)) {
    assert.ok(meta.title && meta.title.trim().length > 0, `${route} has no title`);
  }
});

test("a dynamic detail route backs out to its list, not to the table's static parent", () => {
  // /jobs/247 → back to /jobs (the list), never straight to /explore.
  assert.equal(routeMeta("/jobs/247").parent, "/jobs");
  assert.equal(routeMeta("/pipeline/12").parent, "/pipeline");
  // …and it still lights the tab its section belongs to.
  assert.equal(activeTab("/jobs/247"), "explore");
  assert.equal(activeTab("/pipeline/12"), "pipeline");
});

test("tab roots show no back chevron; detail surfaces do", () => {
  for (const { href } of MOBILE_TABS) assert.equal(hasParent(href), false, href);
  for (const route of ["/apply", "/followups", "/prep", "/config", "/jobs/247"]) {
    assert.equal(hasParent(route), true, route);
  }
});

test("secondary surfaces light the tab they live under, so the bar never goes dark", () => {
  assert.equal(activeTab("/apply"), "today");
  assert.equal(activeTab("/config"), "today");
  assert.equal(activeTab("/followups"), "pipeline");
  assert.equal(activeTab("/prep"), "pipeline");
  assert.equal(activeTab("/portals"), "explore");
});

test("an unknown route degrades to a titled fallback rather than a blank header", () => {
  const meta = routeMeta("/some/route/that/does/not/exist");
  assert.equal(meta.title, "career-ops");
  assert.equal(meta.tab, "today");
  assert.equal(meta.parent, "/");
});

test("trailing slashes, queries and hashes resolve to the same route", () => {
  for (const variant of ["/explore", "/explore/", "/explore?view=fresh", "/explore#top", "/explore/?a=1"]) {
    assert.equal(routeMeta(variant).title, "Explore", variant);
  }
  // The root must not be mangled by the trailing-slash trim.
  assert.equal(routeMeta("/").title, "Today");
});

test("a non-string pathname does not throw", () => {
  for (const bad of [undefined, null, "", 0]) {
    assert.equal(routeMeta(bad).title, "Today", String(bad));
  }
});

test("longest-prefix wins, so a nested section is not swallowed by a shorter one", () => {
  // "/" is excluded from prefix matching or it would match everything.
  assert.equal(routeMeta("/followups/anything").title, "Outreach");
  assert.notEqual(routeMeta("/followups/anything").title, "Today");
});
