import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";

export interface FetchTextOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function fetchText(url: string, options: FetchTextOptions = {}) {
  const proxy = await proxyForUrl();
  if (proxy) {
    return fetchTextViaProxy(url, proxy, options);
  }

  try {
    const response = await fetch(url, {
      headers: options.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 20000)
    });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    throw enrichFetchError(url, error);
  }
}

function fetchTextViaProxy(
  targetUrl: string,
  proxyUrl: string,
  options: FetchTextOptions
) {
  const target = new URL(targetUrl);
  const proxy = new URL(proxyUrl);
  return target.protocol === "https:"
    ? fetchHttpsTextViaProxy(target, proxy, options)
    : fetchHttpTextViaProxy(target, proxy, options);
}

function fetchHttpTextViaProxy(
  target: URL,
  proxy: URL,
  options: FetchTextOptions
) {
  return new Promise<{ ok: boolean; status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(
      {
        protocol: proxy.protocol,
        hostname: proxy.hostname,
        port: proxy.port || "80",
        method: "GET",
        path: target.toString(),
        headers: {
          Host: target.host,
          ...options.headers,
          ...proxyAuthorizationHeader(proxy)
        },
        timeout: options.timeoutMs ?? 20000
      },
      (response) => {
        collectBody(response, resolve);
      }
    );
    request.on("error", (error) => reject(enrichFetchError(target.toString(), error)));
    request.on("timeout", () => {
      request.destroy(new Error("request timed out"));
    });
    request.end();
  });
}

function fetchHttpsTextViaProxy(
  target: URL,
  proxy: URL,
  options: FetchTextOptions
) {
  return new Promise<{ ok: boolean; status: number; body: string }>((resolve, reject) => {
    const connectRequest = httpRequest({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxy.port || "80",
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers: {
        Host: `${target.hostname}:${target.port || 443}`,
        ...proxyAuthorizationHeader(proxy)
      },
      timeout: options.timeoutMs ?? 20000
    });

    connectRequest.once("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(
          new Error(
            `RSS fetch failed for ${target.toString()}: proxy CONNECT ${response.statusCode}`
          )
        );
        return;
      }

      const tlsSocket = tlsConnect({
        socket,
        servername: target.hostname
      });

      const path = `${target.pathname}${target.search}`;
      const request = httpsRequest(
        {
          host: target.hostname,
          servername: target.hostname,
          method: "GET",
          path,
          createConnection: () => tlsSocket,
          headers: {
            Host: target.host,
            ...options.headers
          },
          timeout: options.timeoutMs ?? 20000
        },
        (httpsResponse) => {
          collectBody(httpsResponse, resolve);
        }
      );
      request.on("error", (error) =>
        reject(enrichFetchError(target.toString(), error))
      );
      request.on("timeout", () => {
        request.destroy(new Error("request timed out"));
      });
      request.end();
    });

    connectRequest.on("error", (error) =>
      reject(enrichFetchError(target.toString(), error))
    );
    connectRequest.on("timeout", () => {
      connectRequest.destroy(new Error("proxy CONNECT timed out"));
    });
    connectRequest.end();
  });
}

function collectBody(
  response: NodeJS.ReadableStream & { statusCode?: number },
  resolve: (value: { ok: boolean; status: number; body: string }) => void
) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => {
    const status = response.statusCode ?? 0;
    resolve({
      ok: status >= 200 && status < 300,
      status,
      body: Buffer.concat(chunks).toString("utf8")
    });
  });
}

async function proxyForUrl() {
  const settings = await getProxySettings();
  return settings.proxyEnabled ? settings.proxyUrl || null : null;
}

async function getProxySettings() {
  try {
    const { getSystemSettings } = await import("@/lib/db/repositories");
    const settings = getSystemSettings();
    return {
      proxyEnabled: settings.proxyEnabled,
      proxyUrl: settings.proxyUrl
    };
  } catch {
    // RSS fetching should not silently switch to a proxy when settings are unavailable.
    return {
      proxyEnabled: false,
      proxyUrl: ""
    };
  }
}

function proxyAuthorizationHeader(proxy: URL) {
  if (!proxy.username) return {};
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(
    proxy.password
  )}`;
  return {
    "Proxy-Authorization": `Basic ${Buffer.from(credentials).toString("base64")}`
  };
}

function enrichFetchError(url: string, error: unknown) {
  return new Error(`RSS fetch failed for ${url}: ${errorMessage(error)}`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
