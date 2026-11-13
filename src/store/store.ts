import { useSyncExternalStore } from "react";
import type { Accent } from "../atlas/types";
import type { CardState, Grade } from "./srs";

export type QuizKind = "meaning" | "picture" | "listen" | "spell";
export type Step =
  | { id: string; kind: "intro" }
  | { id: string; kind: QuizKind; retry?: boolean; options?: string[] };

export interface ActiveSession {
  id: string;
  started: number;
  steps: Step[];
  index: number;
  /** First-attempt grade per word; retries never change it. */
  graded: Record<string, Grade>;
  newIds: string[];
  reviewIds: string[];
  /** Answer shown but not yet continued; survives reload without double counting. */
  pending?: { correct: boolean; value: string };
  finished?: number;
}

export interface DayStat {
  n: number; // new words met
  r: number; // graded reviews (first attempts)
  c: number; // correct first attempts
  t: number; // active seconds
}

export interface TypingRound {
  at: number;
  mode: "word" | "sentence" | "dictation";
  items: number;
  wpm: number;
  accuracy: number;
}

export interface Progress {
  version: 2;
  datasetId: string;
  cards: Record<string, CardState>;
  bookmarks: string[];
  days: Record<string, DayStat>;
  typing: TypingRound[];
  session: ActiveSession | null;
  /** Rolling list of recent mistakes, newest first. */
  mistakes: string[];
}

export interface Settings {
  accent: Accent;
  autoplay: boolean;
  dailyNew: number;
  retention: number;
  theme: "system" | "light" | "dark";
  sfx: boolean;
  spell: boolean;
  startLevel: number;
  onboarded: boolean;
  dataset: "open" | "private";
  ambience:
    "off" | "stars" | "rain" | "sea" | "forest" | "fire" | "voyage" | "cafe";
  ambienceVolume: number;
  splash: boolean;
}

export const defaultSettings: Settings = {
  accent: "us",
  autoplay: true,
  dailyNew: 10,
  retention: 0.9,
  theme: "dark",
  sfx: true,
  spell: true,
  startLevel: 0,
  onboarded: false,
  dataset: "open",
  ambience: "stars",
  ambienceVolume: 0.45,
  splash: true,
};

export const emptyProgress = (datasetId: string): Progress => ({
  version: 2,
  datasetId,
  cards: {},
  bookmarks: [],
  days: {},
  typing: [],
  session: null,
  mistakes: [],
});

export const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const SETTINGS_KEY = "word-atlas:settings";
const IDENTITY_KEY = "word-atlas:identity";
export interface AccountUser {
  id: string;
  username: string;
}
export interface LocalAccount {
  user: AccountUser;
  revision: number;
  pending: string | null;
  updatedAt: string;
}
const progressKey = (id: string, user?: AccountUser) =>
  user ? `word-atlas:v2:user:${user.id}:${id}` : `word-atlas:v2:${id}`;
const validUser = (v: unknown): v is AccountUser =>
  isObj(v) &&
  typeof v.id === "string" &&
  /^[a-f0-9-]{36}$/.test(v.id) &&
  typeof v.username === "string";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/* ---------- validation (backups and stored data are untrusted) ---------- */

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, lo = -Infinity, hi = Infinity) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

function validCard(v: unknown): v is CardState {
  return (
    isObj(v) &&
    num(v.due, 0) &&
    num(v.s, 0) &&
    num(v.d, 0, 11) &&
    num(v.el, 0) &&
    num(v.sd, 0) &&
    num(v.ls, 0) &&
    num(v.reps, 0) &&
    num(v.lapses, 0) &&
    [0, 1, 2, 3].includes(v.st as number) &&
    (v.last === undefined || num(v.last, 0)) &&
    num(v.seen, 0)
  );
}

export function sanitizeProgress(v: unknown, datasetId: string): Progress {
  const out = emptyProgress(datasetId);
  if (!isObj(v) || v.version !== 2) return out;
  if (isObj(v.cards))
    for (const [k, c] of Object.entries(v.cards))
      if (validCard(c)) out.cards[k] = c;
  if (Array.isArray(v.bookmarks))
    out.bookmarks = v.bookmarks
      .filter((x): x is string => typeof x === "string")
      .slice(0, 20000);
  if (Array.isArray(v.mistakes))
    out.mistakes = v.mistakes
      .filter((x): x is string => typeof x === "string")
      .slice(0, 300);
  if (isObj(v.days))
    for (const [k, d] of Object.entries(v.days))
      if (
        /^\d{4}-\d{2}-\d{2}$/.test(k) &&
        isObj(d) &&
        num(d.n, 0) &&
        num(d.r, 0) &&
        num(d.c, 0) &&
        num(d.t, 0)
      )
        out.days[k] = {
          n: d.n as number,
          r: d.r as number,
          c: d.c as number,
          t: d.t as number,
        };
  if (Array.isArray(v.typing))
    out.typing = v.typing
      .filter(
        (t): t is TypingRound =>
          isObj(t) &&
          num(t.at, 0) &&
          ["word", "sentence", "dictation"].includes(t.mode as string) &&
          num(t.items, 0) &&
          num(t.wpm, 0, 400) &&
          num(t.accuracy, 0, 100),
      )
      .slice(-500);
  const s = v.session;
  if (
    isObj(s) &&
    typeof s.id === "string" &&
    Array.isArray(s.steps) &&
    num(s.index, 0) &&
    isObj(s.graded)
  )
    out.session = s as unknown as ActiveSession;
  return out;
}

export function sanitizeSettings(v: unknown): Settings {
  const s = { ...defaultSettings };
  if (!isObj(v)) return s;
  if (v.accent === "uk" || v.accent === "us") s.accent = v.accent;
  if (typeof v.autoplay === "boolean") s.autoplay = v.autoplay;
  if (num(v.dailyNew, 0, 100)) s.dailyNew = Math.round(v.dailyNew as number);
  if (num(v.retention, 0.7, 0.97)) s.retention = v.retention as number;
  if (v.theme === "system" || v.theme === "light" || v.theme === "dark")
    s.theme = v.theme;
  if (typeof v.sfx === "boolean") s.sfx = v.sfx;
  if (typeof v.spell === "boolean") s.spell = v.spell;
  if (num(v.startLevel, 0, 5))
    s.startLevel = Math.round(v.startLevel as number);
  if (typeof v.onboarded === "boolean") s.onboarded = v.onboarded;
  if (v.dataset === "open" || v.dataset === "private") s.dataset = v.dataset;
  if (
    [
      "off",
      "stars",
      "rain",
      "sea",
      "forest",
      "fire",
      "voyage",
      "cafe",
    ].includes(v.ambience as string)
  )
    s.ambience = v.ambience as Settings["ambience"];
  if (num(v.ambienceVolume, 0, 1))
    s.ambienceVolume = v.ambienceVolume as number;
  if (typeof v.splash === "boolean") s.splash = v.splash;
  return s;
}

/* ---------- store ---------- */

interface State {
  progress: Progress;
  settings: Settings;
  saveError: boolean;
  account: LocalAccount | null;
  locked: boolean;
}

let state: State = {
  progress: emptyProgress("word-atlas-open"),
  settings: sanitizeSettings(read(SETTINGS_KEY)),
  saveError: false,
  account: null,
  locked: false,
};
const listeners = new Set<() => void>();
let saveTimer: number | undefined;
/** Only write when this tab changed something, so idle tabs never clobber newer data. */
let dirty = false;
/** Progress is written only after it has been read from storage for this dataset. */
let loadedId: string | null = null;

function emit() {
  listeners.forEach((l) => l());
}

function noteChange(previous: State) {
  if (!state.account || state.progress.datasetId !== "word-atlas-open") return;
  const before = previous.progress;
  const after = state.progress;
  const progressChanged = [
    "cards",
    "bookmarks",
    "days",
    "typing",
    "mistakes",
  ].some(
    (key) => before[key as keyof Progress] !== after[key as keyof Progress],
  );
  const settingChanged = Object.keys(state.settings).some(
    (key) =>
      key !== "dataset" &&
      key !== "onboarded" &&
      state.settings[key as keyof Settings] !==
        previous.settings[key as keyof Settings],
  );
  if (progressChanged || settingChanged)
    state = {
      ...state,
      account: { ...state.account, pending: crypto.randomUUID() },
    };
}

function scheduleSave() {
  dirty = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 250);
}

export function flush() {
  window.clearTimeout(saveTimer);
  if (!dirty) return;
  dirty = false;
  const value = state.account
    ? {
        progress: state.progress,
        settings: state.settings,
        account: state.account,
      }
    : state.progress;
  const progressOk =
    loadedId !== state.progress.datasetId ||
    write(progressKey(state.progress.datasetId, state.account?.user), value);
  const ok = progressOk && write(SETTINGS_KEY, state.settings);
  if (ok === state.saveError) {
    state = { ...state, saveError: !ok };
    emit();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener(
    "visibilitychange",
    () => document.visibilityState === "hidden" && flush(),
  );
  // Re-read identity together with its profile so tabs never adopt another user's data.
  window.addEventListener("storage", (e) => {
    if (
      e.key === IDENTITY_KEY ||
      e.key === SETTINGS_KEY ||
      e.key === progressKey(state.progress.datasetId, state.account?.user)
    ) {
      window.clearTimeout(saveTimer);
      dirty = false;
      loadProfile(state.progress.datasetId);
    }
  });
}

function loadProfile(datasetId: string) {
  const identity = read<unknown>(IDENTITY_KEY);
  const user = validUser(identity) ? identity : undefined;
  const saved = read<unknown>(progressKey(datasetId, user));
  const envelope = isObj(saved) && isObj(saved.account) ? saved : null;
  const meta = envelope?.account;
  const account: LocalAccount | null = user
    ? {
        user,
        revision:
          isObj(meta) && num(meta.revision, 0) ? (meta.revision as number) : 0,
        pending:
          isObj(meta) && typeof meta.pending === "string" ? meta.pending : null,
        updatedAt:
          isObj(meta) && typeof meta.updatedAt === "string"
            ? meta.updatedAt
            : "",
      }
    : null;
  state = {
    ...state,
    account,
    progress: sanitizeProgress(user ? envelope?.progress : saved, datasetId),
    settings: sanitizeSettings(
      user ? (envelope?.settings ?? read(SETTINGS_KEY)) : read(SETTINGS_KEY),
    ),
  };
  loadedId = datasetId;
  emit();
}

export const store = {
  get: () => state,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  useDataset(datasetId: string) {
    flush();
    loadProfile(datasetId);
  },
  lock(locked: boolean) {
    state = { ...state, locked };
    emit();
  },
  progress(fn: (p: Progress) => Progress) {
    if (state.locked) return;
    const previous = state;
    state = { ...state, progress: fn(state.progress) };
    noteChange(previous);
    scheduleSave();
    emit();
  },
  settings(patch: Partial<Settings>) {
    if (state.locked) return;
    const previous = state;
    state = { ...state, settings: { ...state.settings, ...patch } };
    noteChange(previous);
    scheduleSave();
    emit();
  },
  applyRemote(
    user: AccountUser,
    progress: Progress,
    settings: Partial<Settings>,
    revision: number,
    updatedAt: string,
  ) {
    window.clearTimeout(saveTimer);
    dirty = false;
    state = {
      ...state,
      progress: { ...progress, session: null },
      settings: {
        ...state.settings,
        ...settings,
        dataset: "open",
        onboarded: true,
      },
      account: { user, revision, pending: null, updatedAt },
    };
    loadedId = progress.datasetId;
    dirty = true;
    flush();
    if (!write(IDENTITY_KEY, user)) state = { ...state, saveError: true };
    emit();
  },
  acknowledge(
    userId: string,
    pending: string | null,
    revision: number,
    updatedAt: string,
  ) {
    if (state.account?.user.id !== userId) return;
    state = {
      ...state,
      account: {
        ...state.account,
        revision,
        updatedAt,
        pending:
          state.account.pending === pending ? null : state.account.pending,
      },
    };
    dirty = true;
    flush();
    emit();
  },
  clearAccount() {
    window.clearTimeout(saveTimer);
    dirty = false;
    const datasetId = state.progress.datasetId;
    try {
      if (state.account)
        localStorage.removeItem(
          progressKey("word-atlas-open", state.account.user),
        );
      localStorage.removeItem(IDENTITY_KEY);
      localStorage.removeItem(progressKey("word-atlas-open"));
      localStorage.removeItem(progressKey(datasetId));
    } catch {
      state = { ...state, saveError: true };
    }
    state = { ...state, account: null, progress: emptyProgress(datasetId) };
    loadedId = datasetId;
    dirty = true;
    flush();
    emit();
  },
};

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(state),
    () => select(state),
  );
}

export function bumpDay(p: Progress, patch: Partial<DayStat>): Progress {
  const k = dayKey();
  const d = p.days[k] ?? { n: 0, r: 0, c: 0, t: 0 };
  return {
    ...p,
    days: {
      ...p.days,
      [k]: {
        n: d.n + (patch.n ?? 0),
        r: d.r + (patch.r ?? 0),
        c: d.c + (patch.c ?? 0),
        t: d.t + (patch.t ?? 0),
      },
    },
  };
}

export function toggleBookmark(id: string) {
  store.progress((p) => ({
    ...p,
    bookmarks: p.bookmarks.includes(id)
      ? p.bookmarks.filter((x) => x !== id)
      : [id, ...p.bookmarks],
  }));
}

/* ---------- backup ---------- */

export function exportBackup() {
  flush();
  const { progress, settings } = state;
  return JSON.stringify(
    {
      app: "word-atlas",
      version: 2,
      exported: new Date().toISOString(),
      progress: { ...progress, session: null },
      settings,
    },
    null,
    1,
  );
}

function markDirty() {
  dirty = true;
}

export function importBackup(
  text: string,
): { ok: true; cards: number } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "文件不是有效的 JSON。" };
  }
  if (
    !isObj(data) ||
    data.app !== "word-atlas" ||
    data.version !== 2 ||
    !isObj(data.progress)
  )
    return { ok: false, error: "这不是词光的学习备份。" };
  const id = state.progress.datasetId;
  if (data.progress.datasetId !== id)
    return { ok: false, error: "备份来自另一个词库，请先切换到对应词库。" };
  if (state.locked) return { ok: false, error: "账号操作进行中，请稍后再试。" };
  const progress = sanitizeProgress({ ...data.progress, session: null }, id);
  const previous = state;
  state = {
    ...state,
    progress,
    settings: { ...sanitizeSettings(data.settings), onboarded: true },
  };
  noteChange(previous);
  markDirty();
  flush();
  emit();
  return { ok: true, cards: Object.keys(progress.cards).length };
}

export function resetProgress() {
  if (state.locked) return;
  const previous = state;
  state = { ...state, progress: emptyProgress(state.progress.datasetId) };
  noteChange(previous);
  markDirty();
  flush();
  emit();
}
