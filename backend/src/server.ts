import { createServer, type Server } from "node:http";

/** Parse a comma-separated list of exact HTTPS origins. Wildcards and paths are rejected. */
export function parseAllowedOrigins(value: string | undefined): ReadonlySet<string> {
  const entries = (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const origins = new Set<string>();

  for (const entry of entries) {
    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error("CORS_ALLOWED_ORIGINS must contain exact HTTPS origins, separated by commas.");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== entry || entry.includes("*")) {
      throw new Error("CORS_ALLOWED_ORIGINS must contain exact HTTPS origins without paths or wildcards.");
    }
    origins.add(entry);
  }

  return origins;
}

/** Operational health endpoint only; this service does not proxy RPC or authorize actions. */
export function createReadinessServer(allowedOrigins: ReadonlySet<string>): Server {
  return createServer((request, response) => {
    const origin = request.headers.origin;
    if (origin !== undefined) {
      if (typeof origin !== "string" || !allowedOrigins.has(origin)) {
        response.writeHead(403, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify({ error: "Origin not allowed" }));
        return;
      }
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type");
      response.setHeader("Vary", "Origin");
    }

    const pathname = (request.url ?? "/").split("?", 1)[0];
    if (pathname !== "/health") {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET, OPTIONS", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify({ status: "ok" }));
  });
}
