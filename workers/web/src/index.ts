/**
 * Parallel Cloudflare hosting for the SMART trip web app — runs next to the
 * existing Vercel deploy so we can validate Cloudflare end-to-end before
 * migrating any backend code.
 *
 * - Static SPA: served from ./dist via the ASSETS binding (SPA fallback handled
 *   by `not_found_handling = "single-page-application"` in wrangler.toml).
 * - /api/*: proxied to the live Vercel backend (`API_ORIGIN`) so the app works
 *   with NO backend rewrite. This proxy is the migration seam — as each route is
 *   reimplemented natively on Workers (starting with the Live Activity push /
 *   Durable Object timers), it stops being proxied here.
 *
 * `run_worker_first = ["/api/*"]` guarantees this Worker sees /api/* before the
 * SPA fallback would otherwise return index.html for them.
 */
export interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  /** Origin that /api/* is proxied to (the Vercel backend), e.g. https://smarttraintrip.com */
  API_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const upstream = new URL(env.API_ORIGIN);
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      // Re-issue against the Vercel origin. Constructing the Request from the
      // upstream URL lets the runtime set the Host header to the origin's, so
      // Vercel's domain routing matches; method/headers/body are preserved.
      return fetch(new Request(upstream.toString(), request));
    }

    // Non-API: static asset or SPA-fallback index.html.
    return env.ASSETS.fetch(request);
  },
};
