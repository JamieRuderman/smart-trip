import type { VercelRequest, VercelResponse } from "@vercel/node";

function isAllowedOrigin(origin: string): boolean {
  return (
    origin === "capacitor://localhost" ||
    origin === "ionic://localhost" ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("https://localhost")
  );
}

export function applyCors(req: VercelRequest, res: VercelResponse): boolean {
  const originHeader = req.headers.origin;
  const origin =
    typeof originHeader === "string" ? originHeader : undefined;
  const allowOrigin = origin && isAllowedOrigin(origin) ? origin : "*";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}

