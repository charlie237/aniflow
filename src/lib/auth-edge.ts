/**
 * Edge/Node-safe auth helpers for Next.js proxy (Web Crypto only).
 */

export const SESSION_COOKIE = "aniflow_session";

export function isAuthEnabledFromEnv() {
  return Boolean(process.env.AUTH_PASSWORD?.trim());
}

export function authSecretFromEnv() {
  const password = process.env.AUTH_PASSWORD?.trim() ?? "";
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (password) return `aniflow:${password}:session`;
  return "aniflow-dev-secret";
}

export async function verifySessionTokenEdge(
  token: string | null | undefined,
  now = Date.now()
) {
  if (!isAuthEnabledFromEnv()) return true;
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp * 1000 < now) return false;
  const expected = await signPayloadEdge(payload);
  return timingSafeEqualString(signature, expected);
}

export async function verifyPasswordEdge(password: string) {
  if (!isAuthEnabledFromEnv()) return true;
  const expected = process.env.AUTH_PASSWORD?.trim() ?? "";
  return timingSafeEqualString(password, expected);
}

async function signPayloadEdge(payload: string) {
  const secret = authSecretFromEnv();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`aniflow:v1:${payload}`)
  );
  return bufferToHex(signature);
}

function bufferToHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualString(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}
