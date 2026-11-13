import assert from "node:assert/strict";
import { test } from "node:test";
import { createEdgeHandler, validateConfig } from "./handler.mjs";

const config = {
  apiOrigin: "https://word-api.yckara.top",
  ossBaseUrl: "https://word-atlas-oss.oss-cn-shenzhen.aliyuncs.com/word-atlas",
  mediaCacheVersion: "v1",
};
const mediaUrl = "https://word.yckara.top/atlas/img/abandon.webp";

function cacheFixture() {
  const entries = new Map();
  const counts = { gets: 0, puts: 0 };
  return {
    counts,
    async get(key) {
      counts.gets++;
      assert.equal(new URL(key).protocol, "http:");
      return entries.get(key)?.clone();
    },
    async put(key, response) {
      counts.puts++;
      assert.equal(new URL(key).protocol, "http:");
      assert.equal(response.headers.get("set-cookie"), null);
      await response.clone().arrayBuffer();
      entries.set(key, response);
    },
  };
}

test("API proxy preserves uploads, identity, cookies and conflict responses without shared caching", async () => {
  const cache = cacheFixture();
  const handle = createEdgeHandler(config, {
    cache,
    fetch: async (url, init) => {
      assert.equal(url, "https://word-api.yckara.top/api/sync/word-atlas-open");
      assert.equal(init.method, "PUT");
      assert.equal(init.redirect, "manual");
      assert.equal(init.headers.get("cookie"), "word_atlas_session=secret");
      assert.equal(init.headers.get("origin"), "https://word.yckara.top");
      assert.equal(init.headers.get("x-atlas-user"), "user-a");
      assert.equal(init.headers.get("host"), null);
      assert.deepEqual(JSON.parse(new TextDecoder().decode(init.body)), {
        baseRevision: 1,
        snapshot: {},
      });
      return new Response(
        '{"success":false,"error":{"code":"DATA_CONFLICT"}}',
        {
          status: 409,
          headers: {
            "content-type": "application/json",
            "set-cookie":
              "word_atlas_session=next; Path=/api; HttpOnly; Secure; SameSite=Lax",
            "cache-control": "public, max-age=600",
          },
        },
      );
    },
  });
  const response = await handle(
    new Request("https://word.yckara.top/api/sync/word-atlas-open", {
      method: "PUT",
      headers: {
        cookie: "word_atlas_session=secret",
        origin: "https://word.yckara.top",
        "x-atlas-user": "user-a",
        "content-type": "application/json",
        host: "untrusted.example",
      },
      body: JSON.stringify({ baseRevision: 1, snapshot: {} }),
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure/);
  assert.equal((await response.json()).error.code, "DATA_CONFLICT");
  assert.deepEqual(cache.counts, { gets: 0, puts: 0 });
});

test("public OSS media never receives login headers and repeated full GETs hit the edge cache", async () => {
  const cache = cacheFixture();
  let requests = 0;
  const handle = createEdgeHandler(config, {
    cache,
    fetch: async (url, init) => {
      requests++;
      assert.equal(url, `${config.ossBaseUrl}/atlas/img/abandon.webp`);
      for (const header of [
        "cookie",
        "authorization",
        "origin",
        "x-atlas-user",
      ])
        assert.equal(init.headers.get(header), null);
      return new Response("image-bytes", {
        headers: {
          "content-type": "image/webp",
          "set-cookie": "unwanted=value",
        },
      });
    },
  });
  const request = () =>
    new Request(`${mediaUrl}?ignored=private`, {
      headers: {
        cookie: "secret",
        authorization: "secret",
        origin: "https://word.yckara.top",
        "x-atlas-user": "private-user",
      },
    });
  const first = await handle(request());
  assert.equal(first.headers.get("x-atlas-cache"), "MISS");
  assert.equal(first.headers.get("set-cookie"), null);
  assert.equal(await first.text(), "image-bytes");
  const second = await handle(request());
  assert.equal(second.headers.get("x-atlas-cache"), "HIT");
  assert.equal(await second.text(), "image-bytes");
  assert.equal(requests, 1);
  assert.deepEqual(cache.counts, { gets: 2, puts: 1 });
});

test("audio Range requests preserve 206 and Content-Range and bypass full-object caching", async () => {
  const cache = cacheFixture();
  const handle = createEdgeHandler(config, {
    cache,
    fetch: async (_url, init) => {
      assert.equal(init.headers.get("range"), "bytes=0-3");
      return new Response("part", {
        status: 206,
        headers: {
          "content-type": "audio/mpeg",
          "content-range": "bytes 0-3/100",
          "accept-ranges": "bytes",
        },
      });
    },
  });
  const response = await handle(
    new Request("https://word.yckara.top/atlas/audio/us/abandon.mp3", {
      headers: { range: "bytes=0-3" },
    }),
  );
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 0-3/100");
  assert.equal(response.headers.get("x-atlas-cache"), "BYPASS");
  assert.equal(await response.text(), "part");
  assert.deepEqual(cache.counts, { gets: 0, puts: 0 });
});

test("media HEAD and conditional responses do not poison the complete-object cache", async () => {
  const cache = cacheFixture();
  const handle = createEdgeHandler(config, {
    cache,
    fetch: async (_url, init) =>
      init.method === "HEAD"
        ? new Response(null, { headers: { "content-type": "image/webp" } })
        : new Response(null, { status: 304, headers: { etag: '"revision"' } }),
  });
  const head = await handle(new Request(mediaUrl, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const conditional = await handle(
    new Request(mediaUrl, { headers: { "if-none-match": '"revision"' } }),
  );
  assert.equal(conditional.status, 304);
  assert.deepEqual(cache.counts, { gets: 0, puts: 0 });
});

test("missing or forbidden OSS objects are never cached", async () => {
  for (const status of [403, 404]) {
    const cache = cacheFixture();
    const handle = createEdgeHandler(config, {
      cache,
      fetch: async () => new Response("not available", { status }),
    });
    const response = await handle(new Request(mediaUrl));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(cache.counts.puts, 0);
    await response.text();
  }
});

test("cache failure falls back to OSS and upstream errors return a safe JSON gateway error", async () => {
  const handle = createEdgeHandler(config, {
    cache: {
      get: async () => {
        throw new Error("cache failure");
      },
      put: async () => {
        throw new Error("cache failure");
      },
    },
    fetch: async () => new Response("image"),
  });
  assert.equal(await (await handle(new Request(mediaUrl))).text(), "image");
  const broken = createEdgeHandler(config, {
    fetch: async () => {
      throw new Error("internal-secret");
    },
  });
  const response = await broken(
    new Request("https://word.yckara.top/api/auth/me"),
  );
  assert.equal(response.status, 502);
  const body = await response.text();
  assert.equal(JSON.parse(body).error.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(body.includes("internal-secret"), false);
});

test("unknown paths and write attempts cannot turn the edge into a general OSS proxy", async () => {
  const handle = createEdgeHandler(config, {
    fetch: async () => assert.fail("must not fetch"),
  });
  for (const path of [
    "/local/catalog.json",
    "/atlas/index.json",
    "/.env",
    "/atlas/img/arbitrary.txt",
    "/https://other.example/",
  ]) {
    assert.equal(
      (await handle(new Request(`https://word.yckara.top${path}`))).status,
      404,
    );
  }
  assert.equal(
    (await handle(new Request(mediaUrl, { method: "DELETE" }))).status,
    405,
  );
});

test("build rejects private network endpoints and credentials in public configuration", () => {
  assert.throws(
    () =>
      validateConfig({
        ...config,
        ossBaseUrl:
          "https://word-atlas-oss.oss-cn-shenzhen-internal.aliyuncs.com/word-atlas",
      }),
    /内网/,
  );
  assert.throws(
    () => validateConfig({ ...config, ossBaseUrl: "http://media.example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...config,
        ossBaseUrl: "https://user:password@media.example.com",
      }),
    /凭据/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...config,
        apiOrigin: "https://word-api.yckara.top/api",
      }),
    /不带路径/,
  );
});
