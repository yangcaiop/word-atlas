import { parseAuth, parseRemote, parseUser, type Snapshot } from "./snapshot";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function invalidResponse(status: number): ApiError {
  if (status >= 500) {
    return new ApiError(
      status,
      "SERVICE_UNAVAILABLE",
      "账号服务暂时不可用，请稍后重试。",
    );
  }
  return new ApiError(
    status,
    "INVALID_RESPONSE",
    "账号服务响应异常，请稍后重试。",
  );
}

async function request(
  path: string,
  method = "GET",
  body?: unknown,
  userId?: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
      headers: {
        ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
        ...(userId ? { "X-Atlas-User": userId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ApiError(
      0,
      timedOut ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
      timedOut
        ? "账号服务请求超时，请稍后重试。"
        : "无法连接账号服务，请检查网络后重试。",
    );
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw invalidResponse(response.status);
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("success" in value) ||
    typeof value.success !== "boolean"
  ) {
    throw invalidResponse(response.status);
  }
  if (!response.ok || value.success !== true) {
    const error =
      "error" in value && value.error && typeof value.error === "object"
        ? value.error
        : null;
    throw new ApiError(
      response.status,
      error && "code" in error && typeof error.code === "string"
        ? error.code
        : "REQUEST_FAILED",
      error && "message" in error && typeof error.message === "string"
        ? error.message
        : "请求失败，请稍后重试。",
    );
  }
  if (!("data" in value)) throw invalidResponse(response.status);
  return value.data;
}
export const accountApi = {
  async register(username: string, password: string, snapshot: Snapshot) {
    return parseAuth(
      await request("/auth/register", "POST", { username, password, snapshot }),
    );
  },
  async login(username: string, password: string) {
    return parseAuth(
      await request("/auth/login", "POST", { username, password }),
    );
  },
  async me() {
    const data = await request("/auth/me");
    return parseUser(
      data && typeof data === "object" && "user" in data ? data.user : null,
    );
  },
  async pull(userId: string) {
    return parseRemote(
      await request("/sync/word-atlas-open", "GET", undefined, userId),
    );
  },
  async upload(baseRevision: number, snapshot: Snapshot, userId: string) {
    return parseRemote(
      await request(
        "/sync/word-atlas-open",
        "PUT",
        { baseRevision, snapshot },
        userId,
      ),
    );
  },
  async logout(userId: string) {
    await request("/auth/logout", "POST", {}, userId);
  },
};
export type AccountApi = typeof accountApi;
