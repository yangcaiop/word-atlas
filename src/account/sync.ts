import { useSyncExternalStore } from "react";
import { store, flush } from "../store/store";
import { accountApi, ApiError, type AccountApi } from "./api";
import { DATASET_ID, makeSnapshot, type RemoteData } from "./snapshot";

export type SyncPhase =
  | "guest"
  | "checking"
  | "pending"
  | "uploading"
  | "synced"
  | "error"
  | "conflict"
  | "expired";
interface SyncStatus {
  phase: SyncPhase;
  message: string;
  busy: boolean;
}
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "同步失败，请检查网络后重试。";

/** Serializes writes and keeps remote application separate from local edits. */
export class SyncEngine {
  private status: SyncStatus = {
    phase: "guest",
    message: "未登录，数据保存在本地",
    busy: false,
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | null = null;
  private generation = 0;
  private verified = false;
  private paused = false;
  private internal = false;
  private identity: string | undefined;
  constructor(private api: AccountApi = accountApi) {}
  get = () => this.status;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(phase: SyncPhase, message: string, busy = this.status.busy) {
    this.status = { phase, message, busy };
    this.listeners.forEach((listener) => listener());
  }
  private failure(error: unknown) {
    const phase =
      error instanceof ApiError &&
      (error.status === 401 || error.code === "ACCOUNT_CHANGED")
        ? "expired"
        : error instanceof ApiError && error.code === "DATA_CONFLICT"
          ? "conflict"
          : "error";
    if (phase === "expired") this.verified = false;
    this.update(phase, messageOf(error));
  }
  private apply(data: RemoteData) {
    const user = store.get().account?.user;
    if (!user) return;
    this.internal = true;
    try {
      store.applyRemote(
        user,
        data.snapshot.progress,
        data.snapshot.settings,
        data.revision,
        data.updatedAt,
      );
    } finally {
      this.internal = false;
    }
  }
  private schedule() {
    clearTimeout(this.timer);
    if (
      !this.verified ||
      this.paused ||
      ["conflict", "expired"].includes(this.status.phase) ||
      !store.get().account?.pending ||
      store.get().progress.datasetId !== DATASET_ID
    )
      return;
    this.update("pending", "本地有数据待上传");
    this.timer = setTimeout(() => {
      void this.upload().catch(() => {});
    }, 2000);
  }
  start(): () => void {
    this.identity = store.get().account?.user.id;
    const unsubscribe = store.subscribe(() => {
      if (this.internal) return;
      const identity = store.get().account?.user.id;
      if (identity !== this.identity) {
        this.generation++;
        this.identity = identity;
        this.verified = false;
        void this.restore();
      } else this.schedule();
    });
    const online = () => {
      void this.restore();
    };
    window.addEventListener("online", online);
    void this.restore();
    return () => {
      unsubscribe();
      window.removeEventListener("online", online);
      clearTimeout(this.timer);
      this.generation++;
      this.verified = false;
    };
  }
  async restore(): Promise<void> {
    const account = store.get().account;
    if (!account) {
      this.update("guest", "未登录，数据保存在本地", false);
      return;
    }
    if (this.paused || this.status.busy) return;
    if (this.flight) {
      await this.flight.catch(() => {});
      if (this.paused) return;
    }
    const generation = ++this.generation;
    this.update("checking", "正在检查登录状态");
    try {
      const user = await this.api.me();
      if (generation !== this.generation) return;
      if (user.id !== account.user.id)
        throw new ApiError(
          401,
          "ACCOUNT_CHANGED",
          "登录账号已变化，请重新登录。",
        );
      this.verified = true;
      if (store.get().account?.pending) {
        await this.upload();
        return;
      }
      const data = await this.api.pull(account.user.id);
      if (generation !== this.generation) return;
      if (store.get().account?.pending) {
        await this.upload();
        return;
      }
      if (data.revision !== store.get().account?.revision) this.apply(data);
      this.update("synced", "已同步");
    } catch (error) {
      if (generation === this.generation) this.failure(error);
    }
  }
  async authenticate(
    mode: "login" | "register",
    username: string,
    password: string,
  ): Promise<void> {
    if (this.status.busy) throw new Error("账号操作进行中，请稍后再试。");
    if (store.get().progress.datasetId !== DATASET_ID)
      throw new Error("请先切换到公开词库再登录或注册。");
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.paused = true;
    this.verified = false;
    store.lock(true);
    this.update(
      "checking",
      mode === "register" ? "正在注册并保存本地进度" : "正在登录并获取远程进度",
      true,
    );
    try {
      await this.flight?.catch(() => {});
      const { progress, settings } = store.get();
      const data =
        mode === "register"
          ? await this.api.register(
              username,
              password,
              makeSnapshot(progress, settings),
            )
          : await this.api.login(username, password);
      if (generation !== this.generation) return;
      this.internal = true;
      try {
        store.applyRemote(
          data.user,
          data.snapshot.progress,
          data.snapshot.settings,
          data.revision,
          data.updatedAt,
        );
      } finally {
        this.internal = false;
      }
      this.identity = data.user.id;
      this.verified = true;
      this.update("synced", "已同步", false);
    } catch (error) {
      if (generation === this.generation) this.failure(error);
      throw error;
    } finally {
      this.paused = false;
      store.lock(false);
      this.status = { ...this.status, busy: false };
      this.listeners.forEach((l) => l());
    }
  }
  upload(): Promise<void> {
    if (this.flight) return this.flight;
    clearTimeout(this.timer);
    const generation = this.generation;
    const operation = async () => {
      while (
        this.verified &&
        !this.paused &&
        store.get().account?.pending &&
        store.get().progress.datasetId === DATASET_ID
      ) {
        const { account, progress, settings } = store.get();
        if (!account) return;
        this.update("uploading", "正在上传");
        flush();
        const data = await this.api.upload(
          account.revision,
          makeSnapshot(progress, settings),
          account.user.id,
        );
        if (
          generation !== this.generation ||
          account.user.id !== store.get().account?.user.id
        )
          return;
        this.internal = true;
        try {
          store.acknowledge(
            account.user.id,
            account.pending,
            data.revision,
            data.updatedAt,
          );
        } finally {
          this.internal = false;
        }
      }
      if (
        generation === this.generation &&
        store.get().account &&
        !store.get().account?.pending
      )
        this.update("synced", "已同步");
    };
    this.flight = operation()
      .catch((error: unknown) => {
        if (generation === this.generation) this.failure(error);
        throw error;
      })
      .finally(() => {
        this.flight = null;
      });
    return this.flight;
  }
  async retry() {
    if (this.status.phase === "conflict")
      throw new Error("远程数据已更新，请从远程获取。");
    await this.restore();
  }
  async download(): Promise<void> {
    const account = store.get().account;
    if (!account || this.status.busy) return;
    const generation = ++this.generation;
    clearTimeout(this.timer);
    this.paused = true;
    store.lock(true);
    this.update("checking", "正在获取远程数据", true);
    try {
      await this.flight?.catch(() => {});
      const user = await this.api.me();
      if (user.id !== account.user.id)
        throw new ApiError(
          401,
          "ACCOUNT_CHANGED",
          "登录账号已变化，请重新登录。",
        );
      const data = await this.api.pull(account.user.id);
      if (generation !== this.generation) return;
      this.apply(data);
      this.verified = true;
      this.update("synced", "已同步", false);
    } catch (error) {
      this.failure(error);
      throw error;
    } finally {
      this.paused = false;
      store.lock(false);
      this.status = { ...this.status, busy: false };
      this.listeners.forEach((l) => l());
    }
  }
  async logout(discard = false): Promise<void> {
    if (this.status.busy) return;
    if (!discard && store.get().account?.pending) {
      if (!this.verified || this.status.phase === "conflict")
        throw new Error("还有未上传的进度，请重试同步或放弃这些变更后退出。");
      await this.upload();
    }
    clearTimeout(this.timer);
    this.paused = true;
    store.lock(true);
    this.update("checking", "正在退出登录", true);
    try {
      await this.flight?.catch(() => {});
      const userId = store.get().account?.user.id;
      if (!userId) return;
      await this.api.logout(userId);
      this.generation++;
      this.internal = true;
      try {
        store.clearAccount();
      } finally {
        this.internal = false;
      }
      this.identity = undefined;
      this.verified = false;
      this.update("guest", "已退出，当前为全新的游客进度", false);
    } catch (error) {
      this.failure(error);
      throw error;
    } finally {
      this.paused = false;
      store.lock(false);
      this.status = { ...this.status, busy: false };
      this.listeners.forEach((l) => l());
    }
  }
}
export const sync = new SyncEngine();
export const useSyncStatus = () =>
  useSyncExternalStore(sync.subscribe, sync.get, sync.get);
