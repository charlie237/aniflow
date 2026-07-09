import { redirect } from "next/navigation";
import { loginAction } from "@/app/auth-actions";
import { isAuthEnabled } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <Card className="w-full max-w-md border-[var(--line)] shadow-sm">
        <CardHeader>
          <CardTitle className="text-2xl">登录 Aniflow</CardTitle>
          <CardDescription>
            已启用 <code className="text-xs">AUTH_PASSWORD</code>，请输入访问密码。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={loginAction} className="space-y-4">
            <input type="hidden" name="next" value={next.startsWith("/") ? next : "/"} />
            <div className="space-y-2">
              <Label htmlFor="password">访问密码</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
                placeholder="AUTH_PASSWORD"
              />
            </div>
            {error ? (
              <p className="text-sm text-red-600">
                {error === "invalid" ? "密码不正确" : "登录失败，请重试"}
              </p>
            ) : null}
            <Button type="submit" className="w-full" variant="signal">
              进入控制台
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
