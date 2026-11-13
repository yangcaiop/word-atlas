import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { accountApi, ApiError } from "./api";
import { defaultSettings, emptyProgress } from "../store/store";
import { makeSnapshot } from "./snapshot";

const snapshot = makeSnapshot(
  emptyProgress("word-atlas-open"),
  defaultSettings,
);
afterEach(() => mock.restoreAll());

function respond(response: Response) {
  mock.method(globalThis, "fetch", async () => response);
}

function apiFailure(status: number, code: string, message: string) {
  return (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.ok(!error.message.includes("JSON"));
    return true;
  };
}

test("registration reports an unavailable service for an empty proxy error response", async () => {
  respond(
    new Response("", {
      status: 500,
      headers: { "content-type": "text/plain" },
    }),
  );
  await assert.rejects(
    accountApi.register("test_user", "test-password", snapshot),
    apiFailure(500, "SERVICE_UNAVAILABLE", "账号服务暂时不可用，请稍后重试。"),
  );
});

test("HTML gateway failures do not expose response content or parsing errors", async () => {
  respond(new Response("<html>upstream unavailable</html>", { status: 502 }));
  await assert.rejects(
    accountApi.login("test_user", "test-password"),
    apiFailure(502, "SERVICE_UNAVAILABLE", "账号服务暂时不可用，请稍后重试。"),
  );
});

test("invalid successful responses cannot be treated as a successful registration", async () => {
  for (const body of [
    "",
    "<html>application shell</html>",
    '{"success":"true"}',
    '{"success":true}',
  ]) {
    respond(new Response(body, { status: 200 }));
    await assert.rejects(
      accountApi.register("test_user", "test-password", snapshot),
      apiFailure(200, "INVALID_RESPONSE", "账号服务响应异常，请稍后重试。"),
    );
    mock.restoreAll();
  }
});

test("network failures and timeouts have distinct actionable messages", async () => {
  mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    accountApi.register("test_user", "test-password", snapshot),
    apiFailure(0, "NETWORK_ERROR", "无法连接账号服务，请检查网络后重试。"),
  );
  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => {
    throw new DOMException("request timed out", "TimeoutError");
  });
  await assert.rejects(
    accountApi.login("test_user", "test-password"),
    apiFailure(0, "REQUEST_TIMEOUT", "账号服务请求超时，请稍后重试。"),
  );
});

test("structured API errors retain their original business message", async () => {
  respond(
    Response.json(
      {
        success: false,
        error: { code: "USERNAME_TAKEN", message: "用户名已被使用" },
      },
      { status: 409 },
    ),
  );
  await assert.rejects(
    accountApi.register("test_user", "test-password", snapshot),
    apiFailure(409, "USERNAME_TAKEN", "用户名已被使用"),
  );
});

test("valid registration responses still initialize the remote snapshot", async () => {
  const data = {
    user: { id: "12345678-1234-1234-1234-123456789abc", username: "test_user" },
    snapshot,
    revision: 1,
    updatedAt: "2026-11-13T07:00:00.000Z",
  };
  respond(Response.json({ success: true, data }, { status: 201 }));
  assert.deepEqual(
    await accountApi.register("test_user", "test-password", snapshot),
    data,
  );
});
