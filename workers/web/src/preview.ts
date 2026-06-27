/**
 * Preview-only Worker entrypoint.
 *
 * Cloudflare Preview URLs are not generated for Workers that implement Durable
 * Objects. This entrypoint intentionally has no Durable Object export or
 * binding: it serves the built SPA and forwards the read-only API calls to
 * production so previews exercise the real backend.
 */
export interface PreviewEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  API_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const url = new URL(request.url);

    // Live Activity routes are stateful — they register against the *production*
    // Durable Object and fire real APNs pushes. A preview build must never
    // mutate production state, so refuse them here rather than proxy them.
    if (url.pathname.startsWith("/api/liveactivity/")) {
      return Response.json(
        { error: "Live Activity is unavailable on preview builds" },
        { status: 501 },
      );
    }

    // Other /api/* (the read-only GTFS-RT feeds) proxy to production. The
    // upstream origin is fixed and only the path + query are copied, so this
    // cannot be redirected to another host.
    if (url.pathname.startsWith("/api/")) {
      const upstream = new URL(env.API_ORIGIN);
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      return fetch(new Request(upstream.toString(), request));
    }

    // Non-/api requests are served from static assets before the Worker runs
    // (run_worker_first = ["/api/*"]); this keeps the entrypoint self-contained
    // if that routing ever changes.
    return env.ASSETS.fetch(request);
  },
};
