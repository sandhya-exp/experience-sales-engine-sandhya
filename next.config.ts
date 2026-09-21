import type { NextConfig } from "next";

/**
 * The quote module (modules/guided-selling — FastAPI + its own built React app)
 * is served *through* this app, so the whole Sales Engine is one origin: one
 * URL to open locally, one Live URL to submit, and no cross-origin iframe.
 *
 * It is still its own process — Python cannot run inside Node — but nothing
 * outside needs to know that. `npm run dev` starts both; in production the
 * module listens on localhost and only this app is public.
 *
 * Why the rules are shaped this way: the module's React bundle calls its API
 * with root-absolute paths (`fetch("/api/state")`), which, once the page is
 * served from this origin, resolve against *this* app. So `/api/*` has to fall
 * through to the module for anything this app does not define itself:
 *
 *   beforeFiles  the one genuine collision. The module's POST /api/handoff/accept
 *                would otherwise be swallowed by our /api/handoff/[leadId] route
 *                with leadId="accept".
 *   fallback     checked only after *every* route here, dynamic ones included,
 *                so our own endpoints always win and everything else reaches the
 *                module. New endpoints on the module's side keep working with no
 *                change here. (These must not be `afterFiles`: that stage runs
 *                before dynamic routes and would capture /api/handoff/[leadId].)
 *
 * QUOTE_WORKSPACE_URL is read when the config loads (build time for `next build`),
 * so it must be set in the build environment as well as at runtime.
 */
const MODULE_URL = process.env.QUOTE_WORKSPACE_URL?.trim().replace(/\/$/, "") ?? "";

const nextConfig: NextConfig = {
  // Hide Next.js's floating dev-tools button (bottom-left "N"). It's a developer
  // aid, not part of the product, and it sat on top of the sidebar's date.
  // Flip to true (or remove) if you want route info / restart back while building.
  devIndicators: false,
  async redirects() {
    // Customer-facing name is "Talk to Sales"; the route keeps its internal path.
    return [{ source: "/talk-to-sales", destination: "/inquire", permanent: false }];
  },
  async rewrites() {
    if (!MODULE_URL) return { beforeFiles: [], afterFiles: [], fallback: [] };
    return {
      beforeFiles: [{ source: "/api/handoff/accept", destination: `${MODULE_URL}/api/handoff/accept` }],
      afterFiles: [],
      fallback: [
        // The module's page itself, mounted on this origin.
        { source: "/quote-module", destination: `${MODULE_URL}/` },
        { source: "/quote-module/:path*", destination: `${MODULE_URL}/:path*` },
        // Its built bundle and its own static files, which it references from the root.
        { source: "/assets/:path*", destination: `${MODULE_URL}/assets/:path*` },
        { source: "/static/:path*", destination: `${MODULE_URL}/static/:path*` },
        // Everything under /api this app does not define — the module's API.
        { source: "/api/:path*", destination: `${MODULE_URL}/api/:path*` },
      ],
    };
  },
};

export default nextConfig;
