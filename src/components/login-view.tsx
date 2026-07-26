"use client";

import { RadioTower } from "lucide-react";
import { loginAction } from "@/app/auth-actions";
import { AnimateIn } from "@/components/motion";
import { ThemeToggle } from "@/components/theme-toggle";
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

export function LoginView({
  error,
  next
}: {
  error: string | null;
  next: string;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <AnimateIn className="w-full max-w-md" y={14} duration={0.42}>
        <Card className="border-[var(--line)] shadow-[var(--shadow-lg)]">
          <CardHeader className="flex flex-col gap-3">
            <div className="flex size-10 items-center justify-center rounded-[var(--radius)] bg-[var(--ink)] text-[var(--ink-foreground)]">
              <RadioTower className="size-5" />
            </div>
            <div>
              <CardTitle className="text-2xl tracking-tight">登录 Aniflow</CardTitle>
              <CardDescription className="mt-1.5">
                已启用 <code className="data-digits text-xs">AUTH_PASSWORD</code>
                ，请输入访问密码。
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form action={loginAction} className="flex flex-col gap-4">
              <input
                type="hidden"
                name="next"
                value={next.startsWith("/") ? next : "/"}
              />
              <div className="flex flex-col gap-2">
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
                <p className="text-sm text-[var(--danger-text)]">
                  {error === "invalid" ? "密码不正确" : "登录失败，请重试"}
                </p>
              ) : null}
              <Button type="submit" className="w-full" variant="signal">
                进入控制台
              </Button>
            </form>
          </CardContent>
        </Card>
      </AnimateIn>
    </main>
  );
}
