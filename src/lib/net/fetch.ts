import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";
import {
  assertMikanDownloadUrl,
  assertMikanRssUrl
} from "@/lib/net/url-policy";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

export interface FetchTextOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type FetchBytesOptions = FetchTextOptions;

export async function fetchText(url: string, options: FetchTextOptions = {}) {
  const target = assertMikanRssUrl(url);
  const proxy = await proxyForUrl();
  if (proxy) {
    return fetchTextViaProxy(target, proxy, options);
  }

  try {
    const response = await fetch(target, {
      headers: options.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    });
    const body = (await readFetchBody(response)).toString("utf8");
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    throw enrichFetchError(url, error);
  }
}

export async function fetchBytes(url: string, options: FetchBytesOptions = {}) {
  const target = assertMikanDownloadUrl(url);
  const proxy = await proxyForUrl();
  if (proxy) {
    return fetchBytesViaProxy(target, proxy, options);
  }

  try {
    const response = await fetch(target, {
      headers: options.headers,
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    });
    const body = await readFetchBody(response);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    throw enrichFetchError(url, error);
  }
}

function fetchTextViaProxy(
  target: URL,
  proxyUrl: string,
  options: FetchTextOptions
) {
  const proxy = parseProxyUrl(proxyUrl);
  return target.protocol === "https:"
    ? fetchHttpsTextViaProxy(target, proxy, options)
    : fetchHttpTextViaProxy(target, proxy, options);
}

function fetchBytesViaProxy(
  target: URL,
  proxyUrl: string,
  options: FetchBytesOptions
) {
  const proxy = parseProxyUrl(proxyUrl);
  return target.protocol === "https:"
    ? fetchHttpsBytesViaProxy(target, proxy, options)
    : fetchHttpBytesViaProxy(target, proxy, options);
}

function fetchHttpTextViaProxy(
  target: URL,
  proxy: URL,
  options: FetchTextOptions
) {
  return new Promise<{ ok: boolean; status: number; body: string }>((resolve, reject) => {
    const request = proxyRequest(proxy)(
      {
        protocol: proxy.protocol,
        hostname: proxy.hostname,
        port: proxyPort(proxy),
        method: "GET",
        path: target.toString(),
        headers: {
          Host: target.host,
          ...options.headers,
          ...proxyAuthorizationHeader(proxy)
        },
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      },
      (response) => {
        void collectBody(response, options.timeoutMs).then(resolve, (error) =>
          reject(enrichFetchError(target.toString(), error))
        );
      }
    );
    request.on("error", (error) => reject(enrichFetchError(target.toString(), error)));
    request.on("timeout", () => {
      request.destroy(new Error("request timed out"));
    });
    request.end();
  });
}

function fetchHttpBytesViaProxy(
  target: URL,
  proxy: URL,
  options: FetchBytesOptions
) {
  return new Promise<{ ok: boolean; status: number; body: Buffer }>(
    (resolve, reject) => {
      const request = proxyRequest(proxy)(
        {
          protocol: proxy.protocol,
          hostname: proxy.hostname,
          port: proxyPort(proxy),
          method: "GET",
          path: target.toString(),
          headers: {
            Host: target.host,
            ...options.headers,
            ...proxyAuthorizationHeader(proxy)
          },
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        },
        (response) => {
          void collectBinaryBody(response, options.timeoutMs).then(resolve, (error) =>
            reject(enrichFetchError(target.toString(), error))
          );
        }
      );
      request.on("error", (error) =>
        reject(enrichFetchError(target.toString(), error))
      );
      request.on("timeout", () => {
        request.destroy(new Error("request timed out"));
      });
      request.end();
    }
  );
}

function fetchHttpsTextViaProxy(
  target: URL,
  proxy: URL,
  options: FetchTextOptions
) {
  return new Promise<{ ok: boolean; status: number; body: string }>((resolve, reject) => {
    const connectRequest = proxyRequest(proxy)({
      protocol: proxy.protocol,
      hostname: proxy.hostname,
      port: proxyPort(proxy),
      method: "CONNECT",
      path: `${target.hostname}:${target.port || 443}`,
      headers: {
        Host: `${target.hostname}:${target.port || 443}`,
        ...proxyAuthorizationHeader(proxy)
      },
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        },
        (httpsResponse) => {
          void collectBody(httpsResponse, options.timeoutMs).then(resolve, (error) =>
            reject(enrichFetchError(target.toString(), error))
          );
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

function fetchHttpsBytesViaProxy(
  target: URL,
  proxy: URL,
  options: FetchBytesOptions
) {
  return new Promise<{ ok: boolean; status: number; body: Buffer }>(
    (resolve, reject) => {
      const connectRequest = proxyRequest(proxy)({
        protocol: proxy.protocol,
        hostname: proxy.hostname,
        port: proxyPort(proxy),
        method: "CONNECT",
        path: `${target.hostname}:${target.port || 443}`,
        headers: {
          Host: `${target.hostname}:${target.port || 443}`,
          ...proxyAuthorizationHeader(proxy)
        },
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
            timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
          },
          (httpsResponse) => {
            void collectBinaryBody(httpsResponse, options.timeoutMs).then(
              resolve,
              (error) => reject(enrichFetchError(target.toString(), error))
            );
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
    }
  );
}

type ProxyResponse = NodeJS.ReadableStream & {
  statusCode?: number;
  destroy(error?: Error): void;
};

async function collectBody(response: ProxyResponse, timeoutMs?: number) {
  const body = await collectResponse(response, timeoutMs);
  const status = response.statusCode ?? 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: body.toString("utf8")
  };
}

async function collectBinaryBody(response: ProxyResponse, timeoutMs?: number) {
  const body = await collectResponse(response, timeoutMs);
  const status = response.statusCode ?? 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body
  };
}

function collectResponse(response: ProxyResponse, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      fail(new Error("response timed out"));
    }, timeoutMs);

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const normalized = error instanceof Error ? error : new Error(String(error));
      response.destroy(normalized);
      reject(normalized);
    };

    response.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        fail(new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    response.once("end", finish);
    response.once("error", fail);
    response.once("aborted", () => fail(new Error("response aborted")));
    response.once("close", () => {
      if (!settled) fail(new Error("response closed before completion"));
    });
  });
}

async function readFetchBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseProxyUrl(value: string) {
  const proxy = new URL(value);
  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    throw new Error(`Unsupported proxy protocol: ${proxy.protocol}`);
  }
  return proxy;
}

function proxyRequest(proxy: URL) {
  return proxy.protocol === "https:" ? httpsRequest : httpRequest;
}

function proxyPort(proxy: URL) {
  return proxy.port || (proxy.protocol === "https:" ? "443" : "80");
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
