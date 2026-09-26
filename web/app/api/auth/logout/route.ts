import { NextResponse } from "next/server";
import { clearSession } from "@/app/auth-session";

export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  clearSession(response);
  return response;
}
