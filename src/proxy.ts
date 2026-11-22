import { NextResponse, type NextRequest } from "next/server";
import {
  isAuthEnabledFromEnv,
  isLoopbackHostname,
  SESSION_COOKIE,
  verifyPasswordEdge,
  verifySessionTokenEdge
} from "@/lib/auth-edge";
import {
  checkAuthRateLimit,
  clearAuthFailures,
  extractClientKey,
  recordAuthFailure
} from "@/lib/rate-limit";

const PUBLIC_PATHS = new Set([
  "/login",
  "/favicon.ico",
  "/favicon.svg",
  "/api/health"
]);

export async function proxy(request: NextRequest) {
  if (!isAuthEnabledFromEnv()) {
    if (isLoopbackHostname(request.nextUrl.hostname)) {
      return NextResponse.next();
    }
    if (request.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "AUTH_PASSWORD is required for non-local access" },
        { status: 403 }
      );
    }
    return new NextResponse("AUTH_PASSWORD is required for non-local access", {
      status: 403
    });
  }

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    // Already logged in users hitting /login go home.
    if (pathname === "/login" && (await isAuthenticated(request)) === "ok") {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  const authResult = await isAuthenticated(request);
  if (authResult === "ok") {
    return NextResponse.next();
  }
  if (authResult === "rate_limited") {
    return NextResponse.json(
      { error: "Too many failed authentication attempts; try again later" },
      { status: 429 }
    );
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

async function isAuthenticated(
  request: NextRequest
): Promise<"ok" | "unauthorized" | "rate_limited"> {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionTokenEdge(cookie)) return "ok";

  const authorization = request.headers.get("authorization");
  if (!authorization) return "unauthorized";

  const clientKey = extractClientKey(request.headers);
  if (!checkAuthRateLimit(clientKey).allowed) {
    return "rate_limited";
  }

  let valid = false;
  if (authorization.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    valid = await verifyPasswordEdge(token);
  } else if (authorization.startsWith("Basic ")) {
    try {
      const decoded = atob(authorization.slice("Basic ".length).trim());
      const separator = decoded.indexOf(":");
      const password = separator >= 0 ? decoded.slice(separator + 1) : decoded;
      valid = await verifyPasswordEdge(password);
    } catch {
      valid = false;
    }
  }

  if (valid) {
    clearAuthFailures(clientKey);
    return "ok";
  }

  recordAuthFailure(clientKey);
  return "unauthorized";
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
