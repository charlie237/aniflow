import { NextResponse, type NextRequest } from "next/server";
import {
  isAuthEnabledFromEnv,
  SESSION_COOKIE,
  verifyPasswordEdge,
  verifySessionTokenEdge
} from "@/lib/auth-edge";

const PUBLIC_PATHS = new Set(["/login", "/favicon.ico", "/favicon.svg"]);

export async function proxy(request: NextRequest) {
  if (!isAuthEnabledFromEnv()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    // Already logged in users hitting /login go home.
    if (pathname === "/login" && (await isAuthenticated(request))) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (await isAuthenticated(request)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

async function isAuthenticated(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionTokenEdge(cookie)) return true;

  const authorization = request.headers.get("authorization");
  if (!authorization) return false;

  if (authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return verifyPasswordEdge(token);
  }

  if (authorization.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice("Basic ".length).trim());
      const separator = decoded.indexOf(":");
      const password = separator >= 0 ? decoded.slice(separator + 1) : decoded;
      return verifyPasswordEdge(password);
    } catch {
      return false;
    }
  }

  return false;
}

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname.startsWith("/favicon")) return true;
  return false;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
