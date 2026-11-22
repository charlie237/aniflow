"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  isAuthEnabled,
  setSessionCookie,
  verifyPassword
} from "@/lib/auth";
import {
  checkAuthRateLimit,
  clearAuthFailures,
  extractClientKey,
  recordAuthFailure
} from "@/lib/rate-limit";

export async function loginAction(formData: FormData) {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const password = formData.get("password")?.toString() ?? "";
  const nextRaw = formData.get("next")?.toString() || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  const clientKey = extractClientKey(await headers());

  if (!checkAuthRateLimit(clientKey).allowed) {
    redirect(`/login?error=rate_limited&next=${encodeURIComponent(next)}`);
  }

  if (!verifyPassword(password)) {
    recordAuthFailure(clientKey);
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  }

  clearAuthFailures(clientKey);
  await setSessionCookie();
  redirect(next);
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect(isAuthEnabled() ? "/login" : "/");
}
