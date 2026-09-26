import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const sessionCookie = "proofpay_session";
const challengeCookie = "proofpay_challenge";
const addressPattern = /^0x[0-9a-fA-F]{40}$/;

function secret(): Buffer {
  const value = process.env.AUTH_SECRET;
  if (!value || !/^[0-9a-f]{64}$/i.test(value))
    throw new Error("AUTH_SECRET must be 32 random bytes in hex");
  return Buffer.from(value, "hex");
}

function seal(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function open(value?: string): Record<string, unknown> | null {
  if (!value) return null;
  const [body, mac, extra] = value.split(".");
  if (!body || !mac || extra) return null;
  const expected = createHmac("sha256", secret()).update(body).digest();
  const actual = Buffer.from(mac, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function signInMessage(address: string, nonce: string, host: string, issuedAt: number): string {
  return `ProofPay wallet sign-in\nDomain: ${host}\nAddress: ${address}\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt * 1000).toISOString()}\n\nSigning proves you control this wallet. It does not make a blockchain transaction.`;
}

export function issueChallenge(request: NextRequest, response: NextResponse, address: string): string {
  const now = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString("hex");
  const host = request.nextUrl.host;
  response.cookies.set(challengeCookie, seal({ a: address.toLowerCase(), n: nonce, h: host, i: now }), {
    httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 300,
  });
  return signInMessage(address.toLowerCase(), nonce, host, now);
}

export function readChallenge(request: NextRequest, address: string): string | null {
  const payload = open(request.cookies.get(challengeCookie)?.value);
  const now = Math.floor(Date.now() / 1000);
  if (!payload || payload.a !== address.toLowerCase() || payload.h !== request.nextUrl.host ||
    typeof payload.n !== "string" || !/^[0-9a-f]{32}$/.test(payload.n) ||
    typeof payload.i !== "number" || payload.i > now || now - payload.i > 300)
    return null;
  return signInMessage(address.toLowerCase(), payload.n, request.nextUrl.host, payload.i);
}

export function issueSession(request: NextRequest, response: NextResponse, address: string) {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  response.cookies.set(sessionCookie, seal({ a: address.toLowerCase(), e: expires }), {
    httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60,
  });
  response.cookies.delete(challengeCookie);
}

export function readSession(request: NextRequest): string | null {
  const payload = open(request.cookies.get(sessionCookie)?.value);
  if (!payload || typeof payload.a !== "string" || !addressPattern.test(payload.a) ||
    typeof payload.e !== "number" || payload.e <= Date.now() / 1000)
    return null;
  return payload.a.toLowerCase();
}

export function clearSession(response: NextResponse) {
  response.cookies.delete(sessionCookie);
  response.cookies.delete(challengeCookie);
}

export function validAddress(address: unknown): address is string {
  return typeof address === "string" && addressPattern.test(address);
}
