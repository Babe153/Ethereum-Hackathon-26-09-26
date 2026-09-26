import type { NextRequest } from "next/server";
import { createDecipheriv } from "node:crypto";
import { createPublicClient, fallback, http, type Abi } from "viem";
import escrowJson from "../../../abi/BountyEscrow.abi.json";
import snapshotJson from "../../../demo-data/snapshot.json";
import { readSession } from "@/app/auth-session";

type Context = { params: Promise<{ path: string[] }> };
type EncryptedSnapshot = { format: string; iv: string; tag: string; ciphertext: string };
const encryptedSnapshot = snapshotJson as EncryptedSnapshot;
let cachedSnapshot: Record<string, unknown> | null = null;

function loadSnapshot(): Record<string, unknown> {
  if (cachedSnapshot) return cachedSnapshot;
  const key = process.env.SNAPSHOT_KEY;
  if (!key || !/^[0-9a-f]{64}$/i.test(key) || encryptedSnapshot.format !== "aes-256-gcm")
    throw new Error("Encrypted snapshot is unavailable");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(encryptedSnapshot.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encryptedSnapshot.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encryptedSnapshot.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
  const parsed: unknown = JSON.parse(plaintext);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid snapshot");
  cachedSnapshot = parsed as Record<string, unknown>;
  return cachedSnapshot;
}
const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as `0x${string}` | undefined;
const chain = createPublicClient({ transport: fallback([
  http(process.env.NEXT_PUBLIC_READ_RPC_URL || "https://testnet-explorer.hskchain.net/api/eth-rpc"),
  http(process.env.NEXT_PUBLIC_RPC_URL || "https://testnet.hsk.xyz"),
]) });
type Bounty = { poster: string; worker: string; submissionURI: string; status: number };

async function bountyById(id: string): Promise<Bounty> {
  if (!/^\d{1,20}$/.test(id) || !escrowAddress) throw new Error("Invalid bounty ID");
  return await chain.readContract({ address: escrowAddress, abi: escrowJson as Abi, functionName: "getBounty", args: [BigInt(id)] }) as Bounty;
}

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

  const isPrivate = pathname !== "/health";
  let session: string | null = null;
  if (isPrivate) {
    try { session = readSession(request); }
    catch { return Response.json({ error: "Wallet authentication unavailable" }, { status: 503 }); }
    if (!session) return Response.json({ error: "Wallet signature required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    try {
      if (pathname === "/submissions" && request.method === "POST") {
        const body: unknown = await request.clone().json();
        const bountyId = body && typeof body === "object" && "bountyId" in body ? body.bountyId : null;
        if (typeof bountyId !== "string") return Response.json({ error: "Bounty ID required" }, { status: 400 });
        const bounty = await bountyById(bountyId);
        if (bounty.status !== 1 || bounty.worker.toLowerCase() !== session)
          return Response.json({ error: "Only the assigned worker can submit" }, { status: 403 });
      } else if (pathname.startsWith("/submissions/") && request.method === "GET") {
        const bountyId = request.nextUrl.searchParams.get("bountyId");
        if (!bountyId) return Response.json({ error: "Bounty ID required" }, { status: 400 });
        const bounty = await bountyById(bountyId);
        const submittedPath = new URL(bounty.submissionURI).pathname;
        if (submittedPath !== pathname || ![bounty.poster.toLowerCase(), bounty.worker.toLowerCase()].includes(session))
          return Response.json({ error: "Only task participants can view the deliverable" }, { status: 403 });
      } else if (pathname.startsWith("/reasons/") && request.method === "GET") {
        const bounty = await bountyById(path[1]);
        if (bounty.poster.toLowerCase() !== session)
          return Response.json({ error: "Only the poster can view the report" }, { status: 403 });
      } else {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
    } catch {
      return Response.json({ error: "Could not verify task ownership" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  }

  // Paid bounties are immutable. This snapshot was exported only after checking
  // their submission and reason hashes against HSKChain.
  if (request.method === "GET" && isPrivate) {
    let snapshot: Record<string, unknown>;
    try { snapshot = loadSnapshot(); }
    catch { return Response.json({ error: "Evidence snapshot unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
    if (Object.hasOwn(snapshot, pathname)) {
      const metadata = snapshot._deployment as { escrow?: string; chainId?: string } | undefined;
      const matches = metadata?.escrow?.toLowerCase() === process.env.NEXT_PUBLIC_ESCROW_ADDRESS?.toLowerCase()
        && metadata?.chainId === (process.env.NEXT_PUBLIC_CHAIN_ID || "133");
      if (matches) {
        return Response.json(snapshot[pathname], {
          headers: { "Cache-Control": "private, no-store" },
        });
      }
    }
  }

  const upstream = process.env.SERVICE_UPSTREAM_URL || "http://localhost:8787";
  const serviceSecret = process.env.SERVICE_PROXY_SECRET;
  if (isPrivate && !serviceSecret)
    return Response.json({ error: "Submission service authentication unavailable" }, { status: 503 });
  try {
    const response = await fetch(new URL(pathname, upstream), {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        ...(serviceSecret ? { "x-proofpay-service-secret": serviceSecret } : {}),
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
