import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/app/auth-session";

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ address: readSession(request) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ address: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
