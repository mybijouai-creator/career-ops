import type { MetadataRoute } from "next";

// The installed-app identity. Two rules from the PWA handoff contract shape
// every value here:
//
//   1. `start_url` is the decision queue, NOT a dashboard. Launching the app
//      must put a decision in front of the user, because the queue is the whole
//      reason the app is on the home screen. "/" IS that queue (TodayDashboard).
//   2. `display: standalone` — no browser chrome, so the bottom tab bar is the
//      only global navigation and the theme-color flows into the status bar.
//
// Kept as a Next metadata route (not a static public/manifest.json) so the
// shortcut list and the icon set can never drift from the routes that exist.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "career-ops — AI job search pipeline",
    short_name: "career-ops",
    description:
      "Local-first job search: evaluate offers, tailor CVs, track applications. Every write passes a human gate.",
    start_url: "/",
    id: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // Matches --bg in the dark theme and the THEME_SCRIPT meta in layout.tsx, so
    // the status bar / Dynamic Island reads as one surface with the header.
    theme_color: "#0a0a0a",
    background_color: "#0a0a0a",
    categories: ["productivity", "business", "utilities"],
    icons: [
      // `any` keeps the glyph edge-to-edge for favicons and tab strips; the
      // `maskable` pair is padded inside the brand field so Android's adaptive
      // mask can crop to a circle/squircle without clipping the mark (#dd7627).
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Explore roles",
        short_name: "Explore",
        description: "Triage discovered postings — scanning and filtering cost zero tokens",
        url: "/explore",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Ask the agent",
        short_name: "Agent",
        description: "Natural language in, components out",
        url: "/agent",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
