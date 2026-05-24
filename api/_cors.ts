import type { VercelRequest, VercelResponse } from "@vercel/node";

const STATIC_ALLOWED = [
  "capacitor://localhost",
  "ionic://localhost",
];

const STATIC_ALLOWED_PREFIXES = [
  "http://localhost",
  "http://127.0.0.1",
  "https://localhost",
];

function envAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin: string): boolean {
  if (STATIC_ALLOWED.includes(origin)) return true;
  if (STATIC_ALLOWED_PREFIXES.some((p) => origin.startsWith(p))) return true;
  return envAllowedOrigins().includes(origin);
}

/**
 * Apply CORS. Returns `true` if the caller should stop further processing
 * (either a handled preflight, or a rejected cross-origin request).
 *
 * Policy:
 *  - Browser requests with an `Origin` header are only allowed from the
 *    static allowlist (capacitor/ionic/localhost) or `ALLOWED_ORIGINS` env.
 *  - Disallowed origins get no `Access-Control-Allow-Origin` header, which
 *    blocks browser reads. Preflights from disallowed origins get 403.
 *  - Requests without an `Origin` header (same-origin, server-to-server,
 *    curl) pass through; CORS can't gate those — rate limiting must.
 */
export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const originHeader = req.headers.origin;
  const origin =
    typeof originHeader === "string" ? originHeader : undefined;
  const allowed = origin ? isAllowedOrigin(origin) : true;

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  if (origin && allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  if (req.method === "OPTIONS") {
    res.status(allowed ? 204 : 403).end();
    return true;
  }

  if (origin && !allowed) {
    res.status(403).json({ error: "Origin not allowed" });
    return true;
  }

  return false;
}
