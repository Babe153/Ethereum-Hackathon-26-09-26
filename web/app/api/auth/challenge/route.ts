import { NextRequest, NextResponse } from "next/server";
import { issueChallenge, validAddress } from "@/app/auth-session";

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  if (!validAddress(address)) return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
  try {
    const response = NextResponse.json({ message: "" }, { headers: { "Cache-Control": "no-store" } });
    const message = issueChallenge(request, response, address);
    // Set-Cookie was applied above; rebuild the response body with the same cookie.
    const result = NextResponse.json({ message }, { headers: { "Cache-Control": "no-store" } });
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    return result;
  } catch {
    return NextResponse.json({ error: "Wallet sign-in unavailable" }, { status: 503 });
  }
}
