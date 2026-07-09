"use server";

import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  isAuthEnabled,
  setSessionCookie,
  verifyPassword
} from "@/lib/auth";

export async function loginAction(formData: FormData) {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const password = formData.get("password")?.toString() ?? "";
  const nextRaw = formData.get("next")?.toString() || "/";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  if (!verifyPassword(password)) {
    redirect(`/login?error=invalid&next=${encodeURIComponent(next)}`);
  }

  await setSessionCookie();
  redirect(next);
}

export async function logoutAction() {
  await clearSessionCookie();
  redirect(isAuthEnabled() ? "/login" : "/");
}
