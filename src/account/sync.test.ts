import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { store, flush, emptyProgress, defaultSettings } from "../store/store";
import { ApiError, type AccountApi } from "./api";
import {
  makeSnapshot,
  parseRemote,
  type AuthData,
  type Snapshot,
} from "./snapshot";
import { SyncEngine } from "./sync";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
Object.assign(globalThis, {
  localStorage: new MemoryStorage(),
  window: { clearTimeout, setTimeout },
});
const user = { id: "12345678-1234-1234-1234-123456789abc", username: "alice" };
const remote = (
  snapshot = makeSnapshot(emptyProgress("word-atlas-open"), defaultSettings),
  revision = 1,
): AuthData => ({
  user,
  snapshot,
  revision,
  updatedAt: "2026-11-13T06:00:00.000Z",
});
function fixture(overrides: Partial<AccountApi> = {}) {
  let data = remote();
  const writes: Snapshot[] = [];
  const api: AccountApi = {
    me: async () => user,
    pull: async () => data,
    register: async (_name, _password, snapshot) => {
      data = remote(snapshot);
      return data;
    },
    login: async () => data,
    upload: async (revision, snapshot) => {
      assert.equal(revision, data.revision);
      writes.push(snapshot);
      data = remote(snapshot, revision + 1);
      return data;
    },
    logout: async () => {},
    ...overrides,
  };
  return { engine: new SyncEngine(api), writes };
}
beforeEach(() => {
  store.lock(false);
  store.clearAccount();
  localStorage.clear();
  store.useDataset("word-atlas-open");
});

test("registration initializes the account with guest progress, while login only applies remote data", async () => {
  store.progress((p) => ({ ...p, bookmarks: ["guest"] }));
  const { engine, writes } = fixture();
  await engine.authenticate("register", "alice", "password123");
  assert.deepEqual(store.get().progress.bookmarks, ["guest"]);
  assert.equal(store.get().account?.pending, null);
  assert.equal(writes.length, 0);
  await engine.logout();
  store.progress((p) => ({ ...p, bookmarks: ["unrelated"] }));
  await engine.authenticate("login", "alice", "password123");
  assert.deepEqual(store.get().progress.bookmarks, ["guest"]);
  assert.equal(writes.length, 0);
});
test("guest changes never upload and malformed remote data is rejected instead of becoming empty progress", async () => {
  const { engine, writes } = fixture();
  store.progress((p) => ({ ...p, bookmarks: ["guest"] }));
  await engine.upload();
  assert.equal(writes.length, 0);
  assert.throws(() =>
    parseRemote({
      ...remote(),
      snapshot: { ...remote().snapshot, progress: { version: 1 } },
    }),
  );
  assert.throws(() =>
    parseRemote({
      ...remote(),
      snapshot: {
        ...remote().snapshot,
        settings: { ...remote().snapshot.settings, dailyNew: 200 },
      },
    }),
  );
  assert.deepEqual(store.get().progress.bookmarks, ["guest"]);
});
test("pending edits survive reload and restore uploads them before any remote pull", async () => {
  let pulls = 0;
  const { engine, writes } = fixture({
    pull: async () => {
      pulls++;
      return remote();
    },
  });
  await engine.authenticate("register", "alice", "password123");
  store.progress((p) => ({ ...p, bookmarks: ["offline"] }));
  flush();
  store.useDataset("word-atlas-open");
  assert.ok(store.get().account?.pending);
  await engine.restore();
  assert.equal(pulls, 0);
  assert.deepEqual(writes[0]?.progress.bookmarks, ["offline"]);
  assert.equal(store.get().account?.pending, null);
});
test("an edit made during an upload is sent in a later snapshot and never acknowledged prematurely", async () => {
  let resolveFirst!: (value: AuthData) => void;
  const first = new Promise<AuthData>((resolve) => {
    resolveFirst = resolve;
  });
  const sent: Snapshot[] = [];
  const { engine } = fixture({
    upload: async (revision, snapshot) => {
      sent.push(snapshot);
      return sent.length === 1 ? first : remote(snapshot, revision + 1);
    },
  });
  await engine.authenticate("register", "alice", "password123");
  store.progress((p) => ({ ...p, bookmarks: ["first"] }));
  const uploading = engine.upload();
  store.progress((p) => ({ ...p, bookmarks: ["second"] }));
  resolveFirst(remote(sent[0], 2));
  await uploading;
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1]?.progress.bookmarks, ["second"]);
  assert.equal(store.get().account?.revision, 3);
  assert.equal(store.get().account?.pending, null);
});
test("conflicts retain pending data; manual pull replaces it without uploading it", async () => {
  const { engine } = fixture({
    upload: async () => {
      throw new ApiError(409, "DATA_CONFLICT", "conflict");
    },
  });
  await engine.authenticate("register", "alice", "password123");
  store.progress((p) => ({ ...p, bookmarks: ["pending"] }));
  await assert.rejects(engine.upload());
  assert.equal(engine.get().phase, "conflict");
  assert.deepEqual(store.get().progress.bookmarks, ["pending"]);
  await engine.download();
  assert.deepEqual(store.get().progress.bookmarks, []);
  assert.equal(store.get().account?.pending, null);
});
test("failed login preserves guest data and logout clears local progress without uploading empty data", async () => {
  const broken = fixture({
    login: async () => {
      throw new Error("offline");
    },
  });
  store.progress((p) => ({ ...p, bookmarks: ["guest"] }));
  await assert.rejects(
    broken.engine.authenticate("login", "alice", "password123"),
  );
  assert.deepEqual(store.get().progress.bookmarks, ["guest"]);
  assert.equal(store.get().account, null);
  assert.equal(store.get().locked, false);
  const { engine, writes } = fixture();
  await engine.authenticate("register", "alice", "password123");
  await engine.logout();
  assert.deepEqual(store.get().progress.bookmarks, []);
  assert.equal(store.get().account, null);
  assert.equal(writes.length, 0);
  store.useDataset("word-atlas-open");
  assert.deepEqual(store.get().progress.bookmarks, []);
});

test("login blocks local changes and upload until its remote snapshot has been received", async () => {
  let finish!: (value: AuthData) => void;
  const reply = new Promise<AuthData>((resolve) => {
    finish = resolve;
  });
  const { engine, writes } = fixture({ login: async () => reply });
  store.progress((p) => ({ ...p, bookmarks: ["guest"] }));
  const login = engine.authenticate("login", "alice", "password123");
  store.progress((p) => ({ ...p, bookmarks: ["during-login"] }));
  await engine.upload();
  assert.deepEqual(store.get().progress.bookmarks, ["guest"]);
  assert.equal(writes.length, 0);
  finish(remote());
  await login;
  assert.deepEqual(store.get().progress.bookmarks, []);
  assert.equal(store.get().locked, false);
});

test("session-only changes remain local and a failed download preserves account progress", async () => {
  const { engine } = fixture({
    pull: async () => {
      throw new Error("offline");
    },
  });
  await engine.authenticate("register", "alice", "password123");
  store.progress((p) => ({
    ...p,
    session: {
      id: "s1",
      started: 1,
      steps: [],
      index: 0,
      graded: {},
      newIds: [],
      reviewIds: [],
    },
  }));
  assert.equal(store.get().account?.pending, null);
  store.progress((p) => ({ ...p, bookmarks: ["saved"] }));
  await assert.rejects(engine.download());
  assert.deepEqual(store.get().progress.bookmarks, ["saved"]);
  assert.equal(store.get().progress.session?.id, "s1");
  assert.ok(store.get().account?.pending);
});

test("restoring an unchanged remote version preserves this device's active session", async () => {
  const { engine } = fixture();
  await engine.authenticate("register", "alice", "password123");
  store.progress((p) => ({
    ...p,
    session: {
      id: "resume",
      started: 1,
      steps: [],
      index: 0,
      graded: {},
      newIds: [],
      reviewIds: [],
    },
  }));
  await engine.restore();
  assert.equal(store.get().progress.session?.id, "resume");
  await engine.download();
  assert.equal(store.get().progress.session, null);
});

test("a slow startup pull cannot overwrite a later explicit remote download", async () => {
  let resolveOld!: (value: AuthData) => void;
  const oldResponse = new Promise<AuthData>((resolve) => {
    resolveOld = resolve;
  });
  let reads = 0;
  const latest = remote(
    {
      ...remote().snapshot,
      progress: { ...remote().snapshot.progress, bookmarks: ["latest"] },
    },
    2,
  );
  const { engine } = fixture({
    pull: async () => (++reads === 1 ? oldResponse : latest),
  });
  await engine.authenticate("register", "alice", "password123");
  const restoring = engine.restore();
  await Promise.resolve();
  await engine.download();
  resolveOld(remote());
  await restoring;
  assert.deepEqual(store.get().progress.bookmarks, ["latest"]);
  assert.equal(store.get().account?.revision, 2);
});
