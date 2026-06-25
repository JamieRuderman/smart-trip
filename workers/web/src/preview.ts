/**
 * Preview-only Worker entrypoint.
 *
 * Cloudflare Preview URLs are not generated for Workers that implement Durable
 * Objects. This entrypoint intentionally has no Durable Object export or
 * binding: it serves the built SPA and forwards API calls to production.
 */
export interface PreviewEnv {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  API_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const upstream = new URL(env.API_ORIGIN);
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      return fetch(new Request(upstream.toString(), request));
    }

    return env.ASSETS.fetch(request);
  },
};
