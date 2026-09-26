import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { readReason, readSubmission, saveSubmission } from "./store.js";
import { readHealth } from "./health.js";

loadEnv({ path: resolve(process.cwd(), "../.env") });
const port = Number(process.env.SERVICE_PORT || 8787);
const baseUrl = process.env.SERVICE_BASE_URL || `http://localhost:${port}`;
const json = (body: unknown, status = 200) => ({
  status,
  text: JSON.stringify(body),
});
function authorized(token: string | undefined): boolean {
  const expected = process.env.SERVICE_PROXY_SECRET;
  if (!expected || !token) return false;
  const left = Buffer.from(token);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  let result;
  try {
    const url = new URL(req.url || "/", baseUrl);
    if (url.pathname !== "/health" && !authorized(req.headers["x-proofpay-service-secret"] as string | undefined)) {
      res.writeHead(403).end(JSON.stringify({ error: "Service authentication required" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/health")
      result = json({ ok: true, demoMode: process.env.DEMO_MODE === "1", checkedAt: Date.now(), services: { api: { status: 'online', lastSeen: Date.now() }, agent: await readHealth('agent'), verifier: await readHealth('verifier') } });
    else if (req.method === "POST" && url.pathname === "/submissions") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 30_000) throw new Error("Request too large");
      }
      const { content } = JSON.parse(raw);
      if (typeof content !== "string") throw new Error("content must be text");
      const saved = await saveSubmission(content);
      result = json(
        { uri: `${baseUrl}/submissions/${saved.id}`, contentHash: saved.hash },
        201,
      );
    } else if (
      req.method === "GET" &&
      /^\/submissions\/[0-9a-f-]+$/.test(url.pathname)
    ) {
      result = json(await readSubmission(url.pathname.split("/")[2]));
    } else if (req.method === "GET" && /^\/reasons\/\d+$/.test(url.pathname)) {
      result = json(await readReason(url.pathname.split("/")[2]));
    } else result = json({ error: "Not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    result = json({ error: message }, message.includes("ENOENT") ? 404 : 400);
  }
  res.writeHead(result.status).end(result.text);
}).listen(port, () => console.log(`Submission API listening at ${baseUrl}`));
