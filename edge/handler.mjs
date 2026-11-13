const API_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "origin",
  "authorization",
  "x-atlas-user",
  "x-request-id",
  "access-control-request-method",
  "access-control-request-headers",
];
const MEDIA_REQUEST_HEADERS = [
  "accept",
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
];
const RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "accept-ranges",
  "content-range",
  "set-cookie",
  "x-request-id",
  "retry-after",
  "ratelimit",
  "ratelimit-policy",
  "vary",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-methods",
  "access-control-allow-headers",
  "access-control-expose-headers",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "content-security-policy",
  "cross-origin-resource-policy",
  "cross-origin-opener-policy",
  "strict-transport-security",
];
const MEDIA_PATH =
  /^\/atlas\/(?:(?:img|thumb)\/[a-z0-9-]{1,64}\.webp|audio\/(?:uk|us|ex|ex2)\/[a-z0-9-]{1,64}\.mp3)$/;

function copyHeaders(source, names) {
  const headers = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function failure(status, code, message) {
  return new Response(
    JSON.stringify({ success: false, error: { code, message } }),
    {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

export function validateConfig(config) {
  const api = new URL(config.apiOrigin);
  const oss = new URL(config.ossBaseUrl);
  for (const url of [api, oss]) {
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port
    ) {
      throw new Error(
        "回源地址必须是 HTTPS 域名，不含凭据、端口、查询参数或片段。",
      );
    }
    if (url.hostname.includes("-internal.")) {
      throw new Error(
        "Pages 边缘函数无法使用 ECS 内网 Endpoint，请填写 OSS 公网地址。",
      );
    }
  }
  if (api.pathname !== "/")
    throw new Error("ATLAS_API_ORIGIN 只填写 API 来源域名，不带路径。");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(config.mediaCacheVersion))
    throw new Error("媒体缓存版本格式无效。");
  return {
    apiOrigin: api.origin,
    ossBaseUrl: oss.href.replace(/\/$/, ""),
    mediaCacheVersion: config.mediaCacheVersion,
  };
}

/** ESA exposes a global cache with get/put, rather than the browser CacheStorage API. */
export function createEdgeHandler(config, dependencies = {}) {
  const settings = validateConfig(config);
  const fetchOrigin = dependencies.fetch ?? globalThis.fetch;

  async function proxyApi(request, url) {
    const target = new URL(settings.apiOrigin);
    target.pathname = url.pathname;
    target.search = url.search;
    const headers = copyHeaders(request.headers, API_REQUEST_HEADERS);
    // ESA's reserved headers (Host, Connection, etc.) cannot be read or written.
    headers.set("accept-encoding", "identity");
    const upstream = await fetchOrigin(target.href, {
      method: request.method,
      headers,
      redirect: "manual",
      ...(request.method === "GET" || request.method === "HEAD"
        ? {}
        : { body: await request.arrayBuffer() }),
    });
    const responseHeaders = copyHeaders(upstream.headers, RESPONSE_HEADERS);
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("cdn-cache-control", "no-store");
    responseHeaders.set("surrogate-control", "no-store");
    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  }

  async function proxyMedia(request, url) {
    const mediaCache = dependencies.cache ?? globalThis.cache;
    if (request.method !== "GET" && request.method !== "HEAD") {
      return failure(
        405,
        "METHOD_NOT_ALLOWED",
        "媒体仅支持 GET 和 HEAD 请求。",
      );
    }
    // Only complete, unconditional GET responses enter the shared cache.
    const cacheable =
      request.method === "GET" &&
      !["range", "if-range", "if-none-match", "if-modified-since"].some(
        (name) => request.headers.has(name),
      );
    const key = new URL(url.origin);
    // ESA Cache API requires an HTTP cache key. Actual OSS traffic always uses HTTPS.
    key.protocol = "http:";
    key.pathname = `/__word_atlas_media_${settings.mediaCacheVersion}${url.pathname}`;
    if (cacheable && mediaCache) {
      try {
        const hit = await mediaCache.get(key.href);
        if (hit) {
          const headers = copyHeaders(hit.headers, RESPONSE_HEADERS);
          headers.delete("set-cookie");
          headers.set("x-atlas-cache", "HIT");
          return new Response(hit.body, { status: hit.status, headers });
        }
      } catch {
        // A cache failure must not prevent retrieval of public media from OSS.
      }
    }

    const headers = copyHeaders(request.headers, MEDIA_REQUEST_HEADERS);
    headers.set("accept-encoding", "identity");
    const upstream = await fetchOrigin(
      `${settings.ossBaseUrl}${url.pathname}`,
      {
        method: request.method,
        headers,
        redirect: "manual",
      },
    );
    const responseHeaders = copyHeaders(upstream.headers, RESPONSE_HEADERS);
    responseHeaders.delete("set-cookie");
    responseHeaders.set("x-atlas-cache", cacheable ? "MISS" : "BYPASS");
    if (upstream.status === 200 || upstream.status === 206) {
      responseHeaders.set("cache-control", "public, max-age=86400");
    } else {
      responseHeaders.set("cache-control", "no-store");
    }
    const response = new Response(
      request.method === "HEAD" ? null : upstream.body,
      {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      },
    );
    if (cacheable && mediaCache && response.status === 200) {
      try {
        await mediaCache.put(key.href, response.clone());
      } catch {
        // The uncached response remains usable when the edge cache is unavailable.
      }
    }
    return response;
  }

  return async function handleRequest(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        return await proxyApi(request, url);
      }
      if (MEDIA_PATH.test(url.pathname)) return await proxyMedia(request, url);
      return failure(404, "NOT_FOUND", "资源不存在。");
    } catch {
      return failure(
        502,
        "UPSTREAM_UNAVAILABLE",
        "回源服务暂时不可用，请稍后重试。",
      );
    }
  };
}
