import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";
import {
  createBrotliDecompress,
  createGunzip,
  createInflate
} from "node:zlib";
import {
  assertMikanDownloadUrl,
  assertMikanRssUrl
} from "@/lib/net/url-policy";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export interface FetchTextOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export type FetchBytesOptions = FetchTextOptions;

export async function fetchText(url: string, options: FetchTextOptions = {}) {
  const result = await fetchWithPolicy(url, assertMikanRssUrl, options);
  return {
    ok: result.ok,
    status: result.status,
    body: result.body.toString("utf8")
  };
}

export async function fetchBytes(url: string, options: FetchBytesOptions = {}) {
  return fetchWithPolicy(url, assertMikanDownloadUrl, options);
}

async function fetchWithPolicy(
  url: string,
  assertUrl: (value: string) => URL,
  options: FetchBytesOptions
): Promise<{ ok: boolean; status: number; body: Buffer }> {
  const target = assertUrl(url);
  const proxy = await proxyForUrl();
  if (proxy) {
    return fetchBytesViaProxy(target, parseProxyUrl(proxy), assertUrl, options);
  }

  try {
    return await fetchDirectWithRedirects(target, assertUrl, options);
  } catch (error) {
    throw enrichFetchError(url, error);
  }
}

async function fetchDirectWithRedirects(
  initialTarget: URL,
  assertUrl: (value: string) => URL,
  options: FetchBytesOptions
): Promise<{ ok: boolean; status: number; body: Buffer }> {
  let current = initialTarget;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
    const response = await fetch(current, {
      headers: options.headers,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location || hops === MAX_REDIRECTS) {
        throw new Error(`Too many redirects or missing Location header (${response.status})`);
      }
      await response.body?.cancel().catch(() => undefined);
      current = assertUrl(new URL(location, current).toString());
      continue;
    }

    const body = await readFetchBody(response);
    return { ok: response.ok, status: response.status, body };
  }

  throw new Error("Too many redirects");
}

async function fetchBytesViaProxy(
  initialTarget: URL,
  proxy: URL,
  assertUrl: (value: string) => URL,
  options: FetchBytesOptions
): Promise<{ ok: boolean; status: number; body: Buffer }> {
  let current = initialTarget;
  for (let hops = 0; hops <= MAX_REDIRECTS; hops += 1) {
    const response =
      current.protocol === "https:"
        ? await requestHttpsViaProxy(current, proxy, options)
        : await requestHttpViaProxy(current, proxy, options);

    if (isRedirectStatus(response.status)) {
      const location = headerString(response.headers.location);
      if (!location || hops === MAX_REDIRECTS) {
        throw enrichFetchError(
          current.toString(),
          new Error(`Too many redirects or missing Location header (${response.status})`)
        );
      }
      current = assertUrl(new URL(location, current).toString());
      continue;
    }

    return {
      ok: response.ok,
      status: response.status,
      body: response.body
    };
  }

  throw enrichFetchError(initialTarget.toString(), new Error("Too many redirects"));
}

interface RawProxyResult {
  ok: boolean;
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

function requestHttpViaProxy(
  target: URL,
  proxy: URL,
  options: FetchBytesOptions
) {
  return new Promise<RawProxyResult>((resolve, reject) => {
    const request = proxyRequest(proxy)(
      {
        protocol: proxy.protocol,
        hostname: proxy.hostname,
        port: proxyPort(proxy),
        method: "GET",
        path: target.toString(),
        headers: {
          Host: target.host,
          "Accept-Encoding": "gzip, deflate, br",
          ...options.headers,
          ...proxyAuthorizationHeader(proxy)
        },
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
      },
      (response) => {
        void collectProxyResponse(response, options.timeoutMs).then(resolve, (error) =>
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
}

function requestHttpsViaProxy(
  target: URL,
  proxy: URL,
  options: FetchBytesOptions
) {
  return new Promise<RawProxyResult>((resolve, reject) => {
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
            "Accept-Encoding": "gzip, deflate, br",
            ...options.headers
          },
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        },
        (httpsResponse) => {
          void collectProxyResponse(httpsResponse, options.timeoutMs).then(
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
  });
}

type ProxyResponse = NodeJS.ReadableStream & {
  statusCode?: number;
  headers?: IncomingHttpHeaders;
  destroy(error?: Error): void;
};

async function collectProxyResponse(
  response: ProxyResponse,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<RawProxyResult> {
  const status = response.statusCode ?? 0;
  const headers = response.headers ?? {};
  if (isRedirectStatus(status)) {
    response.destroy();
    return { ok: false, status, headers, body: Buffer.alloc(0) };
  }

  const stream = decodeContentStream(response, headerString(headers["content-encoding"]));
  const body = await collectStream(stream, response, timeoutMs);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    body
  };
}

function decodeContentStream(
  response: ProxyResponse,
  encodingHeader: string | null
): NodeJS.ReadableStream {
  const encoding = encodingHeader?.split(",")[0]?.trim().toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") {
    const gunzip = createGunzip();
    response.pipe(gunzip);
    return gunzip;
  }
  if (encoding === "deflate") {
    const inflate = createInflate();
    response.pipe(inflate);
    return inflate;
  }
  if (encoding === "br") {
    const brotli = createBrotliDecompress();
    response.pipe(brotli);
    return brotli;
  }
  return response;
}

function collectStream(
  stream: NodeJS.ReadableStream,
  source: ProxyResponse,
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
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
      source.destroy(normalized);
      reject(normalized);
    };

    stream.on("data", (chunk) => {
      const buffer = Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        fail(new Error(`response exceeds ${MAX_RESPONSE_BYTES} bytes`));
        return;
      }
      chunks.push(buffer);
    });
    stream.once("end", finish);
    stream.once("error", fail);
    if (stream !== source) {
      source.once("error", fail);
    }
    source.once("aborted", () => fail(new Error("response aborted")));
    stream.once("close", () => {
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

function isRedirectStatus(status: number) {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function headerString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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
