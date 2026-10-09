import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createReadinessServer, parseAllowedOrigins } from "../src/server.js";

const allowedOrigin = "https://q2fa.example";

async function withServer<T>(
  allowedOrigins: ReadonlySet<string>,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createReadinessServer(allowedOrigins);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("health endpoint is read-only and returns no account or wallet data", async () => {
  await withServer(new Set(), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

test("CORS reflects an exact configured HTTPS origin without wildcard", async () => {
  const origins = parseAllowedOrigins(`${allowedOrigin}`);
  await withServer(origins, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, { headers: { Origin: allowedOrigin } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
    assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("vary"), "Origin");
    const preflight = await fetch(`${baseUrl}/health`, { method: "OPTIONS", headers: { Origin: allowedOrigin } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  });
});

test("CORS rejects an origin that is not on the allow-list", async () => {
  await withServer(parseAllowedOrigins(allowedOrigin), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`, { headers: { Origin: "https://unlisted.example" } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("CORS configuration rejects wildcard, non-HTTPS, and path entries", () => {
  assert.throws(() => parseAllowedOrigins("*"), /exact HTTPS origins/);
  assert.throws(() => parseAllowedOrigins("http://q2fa.example"), /exact HTTPS origins/);
  assert.throws(() => parseAllowedOrigins("https://q2fa.example/path"), /exact HTTPS origins/);
});

test("only GET and OPTIONS on /health are exposed", async () => {
  await withServer(new Set(), async (baseUrl) => {
    const unknown = await fetch(`${baseUrl}/rpc`);
    assert.equal(unknown.status, 404);
    const post = await fetch(`${baseUrl}/health`, { method: "POST" });
    assert.equal(post.status, 405);
  });
});
