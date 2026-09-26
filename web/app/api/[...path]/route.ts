import type { NextRequest } from "next/server";

type Context = { params: Promise<{ path: string[] }> };

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
