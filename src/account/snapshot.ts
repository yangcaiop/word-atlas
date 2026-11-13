import {
  sanitizeProgress,
  sanitizeSettings,
  type Progress,
  type Settings,
  type AccountUser,
} from "../store/store";

export const DATASET_ID = "word-atlas-open";
export type SyncSettings = Omit<Settings, "dataset" | "onboarded">;
export interface Snapshot {
  progress: Progress;
  settings: SyncSettings;
}
export interface RemoteData {
  snapshot: Snapshot;
  revision: number;
  updatedAt: string;
}
export interface AuthData extends RemoteData {
  user: AccountUser;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const number = (v: unknown, low = 0, high = Number.MAX_VALUE): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= low && v <= high;
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v);
const count = (v: unknown) =>
  number(v, 0, Number.MAX_SAFE_INTEGER) && Number.isInteger(v);
const ids = (v: unknown, max: number) =>
  Array.isArray(v) && v.length <= max && v.every(id);
export function syncSettings(settings: Settings): SyncSettings {
  const { dataset: _dataset, onboarded: _onboarded, ...rest } = settings;
  return rest;
}
export function makeSnapshot(progress: Progress, settings: Settings): Snapshot {
  return {
    progress: { ...progress, session: null },
    settings: syncSettings(settings),
  };
}
/** Reject malformed remote snapshots before the forgiving local backup sanitizer can erase data. */
export function parseRemote(value: unknown): RemoteData {
  if (
    !object(value) ||
    !count(value.revision) ||
    !number(value.revision, 1) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !object(value.snapshot)
  )
    throw new Error("远程数据格式无效，已保留本地进度。");
  const { progress: p, settings: s } = value.snapshot;
  if (
    !object(p) ||
    p.version !== 2 ||
    p.datasetId !== DATASET_ID ||
    p.session !== null ||
    !object(p.cards) ||
    Object.keys(p.cards).length > 20000 ||
    !ids(p.bookmarks, 20000) ||
    !ids(p.mistakes, 300) ||
    !object(p.days) ||
    Object.keys(p.days).length > 20000 ||
    !Array.isArray(p.typing) ||
    p.typing.length > 500 ||
    !object(s)
  )
    throw new Error("远程数据版本或结构不支持，已保留本地进度。");
  for (const [key, c] of Object.entries(p.cards)) {
    if (
      !id(key) ||
      !object(c) ||
      !["due", "s", "d", "el", "sd", "ls", "reps", "lapses", "seen"].every(
        (k) => number(c[k]),
      ) ||
      !number(c.d, 0, 11) ||
      ![0, 1, 2, 3].includes(Number(c.st)) ||
      typeof c.st !== "number" ||
      !["ls", "reps", "lapses"].every((k) => count(c[k])) ||
      (c.last !== undefined && !number(c.last, 0, 8.64e15)) ||
      !number(c.due, 0, 8.64e15) ||
      !number(c.seen, 0, 8.64e15)
    )
      throw new Error("远程记忆记录无效，已保留本地进度。");
  }
  for (const [day, stat] of Object.entries(p.days))
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !object(stat) ||
      !["n", "r", "c", "t"].every((k) => count(stat[k]))
    )
      throw new Error("远程学习统计无效。");
  for (const t of p.typing)
    if (
      !object(t) ||
      !number(t.at, 0, 8.64e15) ||
      !["word", "sentence", "dictation"].includes(String(t.mode)) ||
      !count(t.items) ||
      !number(t.wpm, 0, 400) ||
      !number(t.accuracy, 0, 100)
    )
      throw new Error("远程练习记录无效。");
  const cleaned = syncSettings(sanitizeSettings(s));
  if (Object.entries(cleaned).some(([key, v]) => s[key] !== v))
    throw new Error("远程设置无效，已保留本地进度。");
  return {
    revision: value.revision as number,
    updatedAt: value.updatedAt,
    snapshot: { progress: sanitizeProgress(p, DATASET_ID), settings: cleaned },
  };
}
export function parseUser(value: unknown): AccountUser {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.id) ||
    typeof value.username !== "string" ||
    !/^[a-zA-Z0-9_]{3,32}$/.test(value.username)
  )
    throw new Error("账号信息无效，请重试。");
  return { id: value.id, username: value.username };
}
export function parseAuth(value: unknown): AuthData {
  return {
    ...parseRemote(value),
    user: parseUser(object(value) ? value.user : null),
  };
}
