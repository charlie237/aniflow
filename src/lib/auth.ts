import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { appConfig } from "@/lib/config";

export const SESSION_COOKIE = "aniflow_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export function isAuthEnabled() {
  return Boolean(appConfig.authPassword);
}

export function getAuthSecret() {
  return appConfig.authSecret;
}

/** Create a signed session token (Node runtime). */
export function createSessionToken(now = Date.now()) {
  const exp = Math.floor(now / 1000) + SESSION_TTL_SECONDS;
  const payload = String(exp);
  return `${payload}.${signPayload(payload)}`;
}

/** Verify a session token (Node runtime). */
export function verifySessionToken(token: string | null | undefined, now = Date.now()) {
  if (!token || !isAuthEnabled()) return !isAuthEnabled();
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = signPayload(payload);
  return safeEqual(signature, expected);
}

export function verifyPassword(password: string) {
  if (!isAuthEnabled()) return true;
  return safeEqual(password, appConfig.authPassword);
}

export async function setSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export async function hasValidSession() {
  if (!isAuthEnabled()) return true;
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value);
}

function signPayload(payload: string) {
  return createHmac("sha256", getAuthSecret())
    .update(`aniflow:v1:${payload}`)
    .digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
