import { CloudDownload, LogOut, RefreshCw, UserRound } from "lucide-react";
import { useState, useCallback, type FormEvent } from "react";
import { store, useStore } from "../store/store";
import { Sheet } from "../ui/Sheet";
import { toast } from "../ui/Toast";
import { sync, useSyncStatus } from "./sync";

export function AccountPanel() {
  const account = useStore((s) => s.account);
  const datasetId = useStore((s) => s.progress.datasetId);
  const status = useSyncStatus();
  const [mode, setMode] = useState<"login" | "register" | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const run = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (cause) {
      toast(
        cause instanceof Error ? cause.message : "操作失败，请稍后重试",
        "warn",
      );
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mode) return;
    setError("");
    try {
      await sync.authenticate(mode, username, password);
      setPassword("");
      setMode(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "请求失败，请重试。");
    }
  };
  const download = () => {
    if (
      !confirm(
        account?.pending
          ? "从远程获取会覆盖本地进度，未上传的变更将被放弃。继续吗？"
          : "从远程获取会替换本地进度，并结束当前学习会话。继续吗？",
      )
    )
      return;
    void run(() => sync.download());
  };
  const logout = async () => {
    if (
      !confirm(
        "退出后将清空这台设备上的当前进度，以空白游客数据重新开始。已上传的数据保留在账号中。继续吗？",
      )
    )
      return;
    try {
      await sync.logout();
    } catch (cause) {
      if (
        store.get().account?.pending &&
        confirm(
          `${cause instanceof Error ? cause.message : "同步失败"}\n是否放弃未上传的变更并退出？`,
        )
      )
        await run(() => sync.logout(true));
      else
        toast(
          cause instanceof Error ? cause.message : "退出失败，请重试",
          "warn",
        );
    }
  };
  const open = (next: "login" | "register") => {
    setMode(next);
    setPassword("");
    setError("");
  };
  const close = useCallback(() => {
    if (!status.busy) {
      setMode(null);
      setPassword("");
      setError("");
    }
  }, [status.busy]);
  return (
    <section className="panel account-panel">
      <div className="account-heading">
        <UserRound size={22} />
        <h3>{account ? account.user.username : "账号与同步"}</h3>
      </div>
      <p className="muted">
        {account
          ? "进度保存在本机，变化后自动上传到账号。"
          : "无需登录即可使用。注册可保存当前进度，登录可恢复账号中的进度。"}
      </p>
      <p
        className={`account-status ${["error", "expired", "conflict"].includes(status.phase) ? "warn-text" : "muted"}`}
        role="status"
        aria-live="polite"
      >
        {status.message}
      </p>
      {account?.updatedAt && (
        <p className="muted account-time">
          最近同步：{new Date(account.updatedAt).toLocaleString()}
        </p>
      )}
      {datasetId !== "word-atlas-open" && (
        <p className="warn-text">账号同步仅支持公开词库，请先切换词库。</p>
      )}
      <div className="data-actions">
        {account ? (
          <>
            <button
              className="btn btn-ghost"
              disabled={status.busy || datasetId !== "word-atlas-open"}
              onClick={download}
            >
              <CloudDownload size={18} />
              从远程获取
            </button>
            {["error", "pending"].includes(status.phase) && (
              <button
                className="btn btn-ghost"
                disabled={status.busy}
                onClick={() => void run(() => sync.retry())}
              >
                <RefreshCw size={18} />
                重试同步
              </button>
            )}
            {status.phase === "expired" && (
              <button className="btn btn-ghost" onClick={() => open("login")}>
                重新登录
              </button>
            )}
            <button
              className="btn btn-ghost"
              disabled={status.busy}
              onClick={() => void logout()}
            >
              <LogOut size={18} />
              退出登录
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-primary"
              disabled={status.busy || datasetId !== "word-atlas-open"}
              onClick={() => open("register")}
            >
              注册并保存进度
            </button>
            <button
              className="btn btn-ghost"
              disabled={status.busy || datasetId !== "word-atlas-open"}
              onClick={() => open("login")}
            >
              登录已有账号
            </button>
          </>
        )}
      </div>
      <Sheet
        open={mode !== null}
        onClose={close}
        label={mode === "register" ? "注册账号" : "登录账号"}
        centered
      >
        <form className="account-form" onSubmit={(event) => void submit(event)}>
          <h2>{mode === "register" ? "保存你的学习进度" : "欢迎回来"}</h2>
          <p className="muted">
            {mode === "register"
              ? "注册成功后，当前本地进度会保存到新账号。"
              : "登录将使用账号的远程数据替换当前进度，本地数据不会上传。"}
          </p>
          <label>
            用户名
            <input
              name="username"
              autoComplete="username"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_]{3,32}"
              value={username}
              disabled={status.busy}
              onChange={(e) => setUsername(e.target.value)}
              data-autofocus
            />
          </label>
          <p className="muted">3–32 位字母、数字或下划线，不区分大小写。</p>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete={
                mode === "register" ? "new-password" : "current-password"
              }
              required
              minLength={8}
              maxLength={128}
              value={password}
              disabled={status.busy}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <p className="muted">8–128 位。本期不提供密码找回，请妥善保存。</p>
          {error && (
            <p className="warn-text" role="alert">
              {error}
            </p>
          )}
          <button
            className="btn btn-primary"
            disabled={status.busy}
            type="submit"
          >
            {status.busy
              ? "正在处理…"
              : mode === "register"
                ? "注册并同步"
                : "登录并获取进度"}
          </button>
          <button
            className="link"
            type="button"
            disabled={status.busy}
            onClick={() => open(mode === "register" ? "login" : "register")}
          >
            {mode === "register" ? "已有账号，去登录" : "还没有账号，去注册"}
          </button>
        </form>
      </Sheet>
    </section>
  );
}
