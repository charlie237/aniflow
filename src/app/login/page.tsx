import { redirect } from "next/navigation";
import { loginAction } from "@/app/auth-actions";
import { isAuthEnabled } from "@/lib/auth";
import { LoginView } from "@/components/login-view";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isAuthEnabled()) {
    redirect("/");
  }

  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const next = typeof params.next === "string" ? params.next : "/";

  return <LoginView error={error} next={next} />;
}
