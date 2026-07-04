/**
 * smart-trip-liveactivity — the Live Activity push backend Worker.
 *
 * Implements ONLY the `TripActivityDO` Durable Object. It has no routes and no
 * public fetch surface: `smart-trip-web` reaches the DO through a cross-script
 * binding (`script_name = "smart-trip-liveactivity"` in the root wrangler.toml)
 * and proxies the public /api/liveactivity/* routes to it.
 *
 * The DO lives in its OWN Worker so that `smart-trip-web` does not implement a
 * Durable Object — Cloudflare does not generate Preview URLs for Workers that
 * implement one, and this split is what makes per-version preview builds of the
 * web Worker possible (see workers/web/README.md).
 */
export { TripActivityDO } from "./do/tripActivity.js";

export default {
  // Nothing is routed here; the DO is invoked via the cross-script binding.
  async fetch(): Promise<Response> {
    return new Response("smart-trip-liveactivity: no public routes", {
      status: 404,
    });
  },
};
