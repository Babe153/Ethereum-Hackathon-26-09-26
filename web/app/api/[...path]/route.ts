import type { NextRequest } from "next/server";
import snapshotJson from "../../../demo-data/snapshot.json";

type Context = { params: Promise<{ path: string[] }> };
const snapshot = snapshotJson as Record<string, unknown>;

async function forward(request: NextRequest, context: Context) {
  const { path } = await context.params;
  const pathname = `/${path.join("/")}`;
  if (
    pathname !== "/health" &&
    pathname !== "/submissions" &&
    !/^\/submissions\/[0-9a-f-]+$/.test(pathname) &&
    !/^\/reasons\/\d+$/.test(pathname)
  ) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Paid bounties are immutable. This snapshot was exported only after checking
  // their submission and reason hashes against HSKChain.
  if (request.method === "GET" && Object.hasOwn(snapshot, pathname)) {
    return Response.json(snapshot[pathname], {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  }

  const upstream = process.env.SERVICE_UPSTREAM_URL || "http://localhost:8787";
  try {
    const response = await fetch(new URL(pathname, upstream), {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
      },
      body: request.method === "POST" ? await request.text() : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "Submission service unavailable" }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
