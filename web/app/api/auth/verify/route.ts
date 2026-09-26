import { NextRequest, NextResponse } from "next/server";
import { getAddress, verifyMessage, type Hex } from "viem";
import { issueSession, readChallenge, validAddress } from "@/app/auth-session";

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { address, signature } = body as { address?: unknown; signature?: unknown };
  if (!validAddress(address) || typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    return NextResponse.json({ error: "Invalid wallet signature" }, { status: 400 });
  try {
    const message = readChallenge(request, address);
    if (!message || !await verifyMessage({ address: getAddress(address), message, signature: signature as Hex }))
      return NextResponse.json({ error: "Signature was not accepted" }, { status: 401 });
    const response = NextResponse.json({ address: address.toLowerCase() }, { headers: { "Cache-Control": "no-store" } });
    issueSession(request, response, address);
    return response;
  } catch {
    return NextResponse.json({ error: "Wallet sign-in unavailable" }, { status: 503 });
  }
}
