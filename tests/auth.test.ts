import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  isAuthEnabledFromEnv,
  verifyPasswordEdge,
  verifySessionTokenEdge
} from "@/lib/auth-edge";

describe("auth-edge", () => {
  it("is open when AUTH_PASSWORD is unset", async () => {
    const previous = process.env.AUTH_PASSWORD;
    delete process.env.AUTH_PASSWORD;
    try {
      expect(isAuthEnabledFromEnv()).toBe(false);
      expect(await verifySessionTokenEdge(null)).toBe(true);
      expect(await verifyPasswordEdge("anything")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.AUTH_PASSWORD;
      else process.env.AUTH_PASSWORD = previous;
    }
  });

  it("verifies HMAC session tokens and password when enabled", async () => {
    const previousPassword = process.env.AUTH_PASSWORD;
    const previousSecret = process.env.AUTH_SECRET;
    process.env.AUTH_PASSWORD = "test-pass-xyz";
    process.env.AUTH_SECRET = "test-secret-xyz";
    try {
      expect(isAuthEnabledFromEnv()).toBe(true);

      const exp = Math.floor(Date.now() / 1000) + 3600;
      const payload = String(exp);
      const signature = createHmac("sha256", "test-secret-xyz")
        .update(`aniflow:v1:${payload}`)
        .digest("hex");
      const token = `${payload}.${signature}`;

      expect(await verifySessionTokenEdge(token)).toBe(true);
      expect(await verifySessionTokenEdge(`${payload}.00`)).toBe(false);
      expect(await verifySessionTokenEdge("1.abc")).toBe(false);

      const expired = String(Math.floor(Date.now() / 1000) - 10);
      const expiredSig = createHmac("sha256", "test-secret-xyz")
        .update(`aniflow:v1:${expired}`)
        .digest("hex");
      expect(await verifySessionTokenEdge(`${expired}.${expiredSig}`)).toBe(false);

      expect(await verifyPasswordEdge("test-pass-xyz")).toBe(true);
      expect(await verifyPasswordEdge("wrong")).toBe(false);
    } finally {
      if (previousPassword === undefined) delete process.env.AUTH_PASSWORD;
      else process.env.AUTH_PASSWORD = previousPassword;
      if (previousSecret === undefined) delete process.env.AUTH_SECRET;
      else process.env.AUTH_SECRET = previousSecret;
    }
  });
});
