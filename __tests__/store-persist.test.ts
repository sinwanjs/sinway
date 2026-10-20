/**
 * Tests for Zustand-style store persistence (localStorage / custom storage).
 */

import { describe, expect, it, mock } from "bun:test";
import {
  createJSONStorage,
  persistStore,
  type PersistApi,
  type StateStorage,
} from "../src/persist.ts";

function createMemoryStorage(initial?: Record<string, string>): StateStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value);
    },
    removeItem: (name) => {
      map.delete(name);
    },
  };
}

function createAsyncMemoryStorage(
  initial?: Record<string, string>,
): StateStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: async (name) => map.get(name) ?? null,
    setItem: async (name, value) => {
      map.set(name, value);
    },
    removeItem: async (name) => {
      map.delete(name);
    },
  };
}

async function waitHydrated<S extends object>(api: PersistApi<S>): Promise<void> {
  if (api.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const off = api.onFinishHydration(() => {
      off();
      resolve();
    });
    // Hydration may finish between the hasHydrated check and listener attach.
    if (api.hasHydrated()) {
      off();
      resolve();
    }
  });
}

describe("createJSONStorage", () => {
  it("round-trips JSON through a StateStorage", () => {
    const memory = createMemoryStorage();
    const storage = createJSONStorage<{ count: number }>(() => memory);
    expect(storage).toBeDefined();
    storage!.setItem("k", { state: { count: 1 }, version: 0 });
    expect(storage!.getItem("k")).toEqual({
      state: { count: 1 },
      version: 0,
    });
    storage!.removeItem("k");
    expect(storage!.getItem("k")).toBeNull();
  });

  it("returns undefined when getStorage throws", () => {
    const storage = createJSONStorage(() => {
      throw new Error("no storage");
    });
    expect(storage).toBeUndefined();
  });

  it("returns undefined when getStorage returns nullish", () => {
    const storage = createJSONStorage(
      () => null as unknown as StateStorage,
    );
    expect(storage).toBeUndefined();
  });

  it("supports async getItem", async () => {
    const memory = createAsyncMemoryStorage();
    const storage = createJSONStorage<{ n: number }>(() => memory)!;
    await storage.setItem("a", { state: { n: 2 }, version: 1 });
    await expect(storage.getItem("a")).resolves.toEqual({
      state: { n: 2 },
      version: 1,
    });
  });

  it("honors reviver and replacer", () => {
    const memory = createMemoryStorage();
    const storage = createJSONStorage<{ label: string }>(() => memory, {
      replacer: (_key, value) =>
        typeof value === "string" ? `s:${value}` : value,
      reviver: (_key, value) =>
        typeof value === "string" && value.startsWith("s:")
          ? value.slice(2)
          : value,
    })!;
    storage.setItem("d", { state: { label: "hi" }, version: 0 });
    expect(memory.getItem("d")).toContain('"s:hi"');
    expect(storage.getItem("d")).toEqual({
      state: { label: "hi" },
      version: 0,
    });
  });
});

describe("persistStore", () => {
  it("hydrates synchronously from storage and writes on set", async () => {
    const memory = createMemoryStorage({
      bears: JSON.stringify({ state: { count: 3 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [state, setState, api] = persistStore(
      { count: 0 },
      { name: "bears", storage },
    );

    await waitHydrated(api);
    expect(api.hasHydrated()).toBe(true);
    expect(state.count).toBe(3);

    setState("count", 4);
    expect(JSON.parse(memory.getItem("bears") as string)).toEqual({
      state: { count: 4 },
      version: 0,
    });
  });

  it("partializes persisted state", () => {
    const memory = createMemoryStorage();
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [, setState] = persistStore(
      { count: 0, transient: true },
      {
        name: "partial",
        storage,
        partialize: (s) => ({ count: s.count }),
      },
    );
    setState({ count: 9, transient: false });
    expect(JSON.parse(memory.getItem("partial") as string)).toEqual({
      state: { count: 9 },
      version: 0,
    });
  });

  it("supports skipHydration and manual rehydrate", async () => {
    const memory = createMemoryStorage({
      s: JSON.stringify({ state: { count: 5 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [state, , api] = persistStore(
      { count: 0 },
      { name: "s", storage, skipHydration: true },
    );
    expect(api.hasHydrated()).toBe(false);
    expect(state.count).toBe(0);
    await api.rehydrate();
    expect(api.hasHydrated()).toBe(true);
    expect(state.count).toBe(5);
  });

  it("migrates when version mismatches", async () => {
    const memory = createMemoryStorage({
      m: JSON.stringify({ state: { n: 1 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [state, , api] = persistStore(
      { count: 0 },
      {
        name: "m",
        storage,
        version: 2,
        migrate: (persisted, version) => {
          expect(version).toBe(0);
          const old = persisted as { n: number };
          return { count: old.n * 10 };
        },
      },
    );
    await waitHydrated(api);
    expect(api.hasHydrated()).toBe(true);
    expect(state.count).toBe(10);
    expect(JSON.parse(memory.getItem("m") as string).version).toBe(2);
  });

  it("supports async migrate", async () => {
    const memory = createMemoryStorage({
      m: JSON.stringify({ state: { n: 2 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [state, , api] = persistStore(
      { count: 0 },
      {
        name: "m",
        storage,
        version: 1,
        migrate: async (persisted) => {
          const old = persisted as { n: number };
          return { count: old.n };
        },
      },
    );
    await waitHydrated(api);
    expect(state.count).toBe(2);
  });

  it("skips hydration when version mismatches without migrate", async () => {
    const error = mock(() => {});
    const prev = console.error;
    console.error = error;
    try {
      const memory = createMemoryStorage({
        m: JSON.stringify({ state: { count: 99 }, version: 0 }),
      });
      const storage = createJSONStorage<{ count: number }>(() => memory)!;
      const [state, , api] = persistStore(
        { count: 1 },
        { name: "m", storage, version: 1 },
      );
      await waitHydrated(api);
      expect(state.count).toBe(1);
      expect(api.hasHydrated()).toBe(true);
      expect(error).toHaveBeenCalled();
    } finally {
      console.error = prev;
    }
  });

  it("clearStorage removes the key", () => {
    const memory = createMemoryStorage({
      c: JSON.stringify({ state: { count: 1 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [, , api] = persistStore(
      { count: 0 },
      { name: "c", storage, skipHydration: true },
    );
    api.clearStorage();
    expect(memory.getItem("c")).toBeNull();
  });

  it("setOptions updates storage and options", () => {
    const a = createMemoryStorage();
    const b = createMemoryStorage();
    const storageA = createJSONStorage<{ count: number }>(() => a)!;
    const storageB = createJSONStorage<{ count: number }>(() => b)!;
    const [, setState, api] = persistStore(
      { count: 0 },
      { name: "opt", storage: storageA, skipHydration: true },
    );
    api.setOptions({ storage: storageB, name: "opt2" });
    expect(api.getOptions().name).toBe("opt2");
    setState("count", 7);
    expect(b.getItem("opt2")).toContain('"count":7');
    expect(a.getItem("opt")).toBeNull();
  });

  it("fires hydrate and finish listeners", async () => {
    const memory = createMemoryStorage({
      h: JSON.stringify({ state: { count: 2 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const onHydrate = mock(() => {});
    const onFinish = mock(() => {});
    const [, , api] = persistStore(
      { count: 0 },
      { name: "h", storage, skipHydration: true },
    );
    const offH = api.onHydrate(onHydrate);
    const offF = api.onFinishHydration(onFinish);
    await api.rehydrate();
    expect(onHydrate).toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalled();
    offH();
    offF();
  });

  it("calls onRehydrateStorage before and after", async () => {
    const after = mock(() => {});
    const memory = createMemoryStorage({
      r: JSON.stringify({ state: { count: 4 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [, , api] = persistStore(
      { count: 0 },
      {
        name: "r",
        storage,
        skipHydration: true,
        onRehydrateStorage: () => after,
      },
    );
    await api.rehydrate();
    expect(after).toHaveBeenCalled();
  });

  it("invokes onRehydrateStorage error callback when getItem throws", async () => {
    const after = mock(() => {});
    const onFinish = mock(() => {});
    const storage: ReturnType<typeof createJSONStorage<{ count: number }>> = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const [, , api] = persistStore(
      { count: 0 },
      {
        name: "err",
        storage,
        skipHydration: true,
        onRehydrateStorage: () => after,
      },
    );
    api.onFinishHydration(onFinish);
    await api.rehydrate();
    expect(after).toHaveBeenCalled();
    expect(onFinish).toHaveBeenCalled();
    const [, err] = after.mock.calls[0] as unknown as [unknown, unknown];
    expect(err).toBeInstanceOf(Error);
  });

  it("hydrates from async storage", async () => {
    const memory = createAsyncMemoryStorage({
      async: JSON.stringify({ state: { count: 8 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [state, , api] = persistStore(
      { count: 0 },
      { name: "async", storage },
    );
    await waitHydrated(api);
    expect(api.hasHydrated()).toBe(true);
    expect(state.count).toBe(8);
  });

  it("hydrates immediately when storage is missing", async () => {
    const onFinish = mock(() => {});
    const [, , api] = persistStore(
      { count: 0 },
      { name: "nostore", storage: undefined },
    );
    api.onFinishHydration(onFinish);
    // Initial hydrate already ran; re-run to hit the no-storage branch again.
    await api.rehydrate();
    expect(api.hasHydrated()).toBe(true);
    expect(onFinish).toHaveBeenCalled();
  });

  it("warns when storage is unavailable on set", () => {
    const warn = mock(() => {});
    const prev = console.warn;
    console.warn = warn;
    try {
      const [, setState] = persistStore(
        { count: 0 },
        { name: "none", storage: undefined, skipHydration: true },
      );
      setState("count", 1);
      expect(warn).toHaveBeenCalled();
    } finally {
      console.warn = prev;
    }
  });

  it("defaults to no storage when localStorage is missing", () => {
    const warn = mock(() => {});
    const prevWarn = console.warn;
    console.warn = warn;
    const g = globalThis as { localStorage?: StateStorage };
    const prev = g.localStorage;
    delete g.localStorage;
    try {
      const [, setState] = persistStore(
        { count: 0 },
        { name: "no-ls", skipHydration: true },
      );
      setState("count", 1);
      expect(warn).toHaveBeenCalled();
    } finally {
      console.warn = prevWarn;
      if (prev === undefined) {
        delete g.localStorage;
      } else {
        g.localStorage = prev;
      }
    }
  });

  it("uses localStorage by default when available", () => {
    const map = new Map<string, string>();
    const fake: StateStorage = {
      getItem: (name) => map.get(name) ?? null,
      setItem: (name, value) => {
        map.set(name, value);
      },
      removeItem: (name) => {
        map.delete(name);
      },
    };
    const g = globalThis as { localStorage?: StateStorage };
    const prev = g.localStorage;
    g.localStorage = fake;
    try {
      const [, setState] = persistStore(
        { count: 0 },
        { name: "default-ls", skipHydration: true },
      );
      setState("count", 11);
      expect(map.get("default-ls")).toContain('"count":11');
    } finally {
      if (prev === undefined) {
        delete g.localStorage;
      } else {
        g.localStorage = prev;
      }
    }
  });

  it("custom merge replaces nested defaults carefully", async () => {
    const memory = createMemoryStorage({
      deep: JSON.stringify({
        state: { foo: { bar: 9 } },
        version: 0,
      }),
    });
    const storage = createJSONStorage<{
      foo: { bar: number; baz: number };
    }>(() => memory)!;
    const [state, , api] = persistStore(
      { foo: { bar: 0, baz: 1 } },
      {
        name: "deep",
        storage,
        merge: (persisted, current) => {
          const p = persisted as { foo?: { bar: number } } | undefined;
          return {
            foo: {
              ...current.foo,
              ...(p?.foo ?? {}),
            },
          };
        },
      },
    );
    await waitHydrated(api);
    expect(state.foo.bar).toBe(9);
    expect(state.foo.baz).toBe(1);
  });

  it("finishes hydration when storage has no entry", async () => {
    const memory = createMemoryStorage();
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const [state, , api] = persistStore(
      { count: 0 },
      { name: "empty", storage },
    );
    await waitHydrated(api);
    expect(state.count).toBe(0);
    expect(api.hasHydrated()).toBe(true);
  });

  it("aborts stale hydration on error after clearStorage", async () => {
    let rejectGet: (e: Error) => void = () => {};
    const storage = {
      getItem: () =>
        new Promise<{
          state: { count: number };
          version: number;
        } | null>((_resolve, reject) => {
          rejectGet = reject;
        }),
      setItem: () => {},
      removeItem: () => {},
    };
    const after = mock(() => {});
    const [state, , api] = persistStore(
      { count: 0 },
      {
        name: "race-err",
        storage,
        skipHydration: true,
        onRehydrateStorage: () => after,
      },
    );
    const pending = api.rehydrate();
    await Promise.resolve();
    api.clearStorage();
    rejectGet(new Error("late"));
    await pending;
    expect(state.count).toBe(0);
    // Aborted hydrations should not invoke the error callback.
    expect(after).not.toHaveBeenCalled();
  });

  it("aborts stale hydration when clearStorage bumps version", async () => {
    let resolveGet: (v: {
      state: { count: number };
      version: number;
    } | null) => void = () => {};
    const storage = {
      getItem: () =>
        new Promise<{
          state: { count: number };
          version: number;
        } | null>((resolve) => {
          resolveGet = resolve;
        }),
      setItem: () => {},
      removeItem: () => {},
    };
    const [state, , api] = persistStore(
      { count: 0 },
      { name: "race", storage, skipHydration: true },
    );
    const pending = api.rehydrate();
    // getItem is scheduled behind Promise.resolve — wait for it to register.
    await Promise.resolve();
    api.clearStorage();
    resolveGet({ state: { count: 50 }, version: 0 });
    await pending;
    expect(state.count).toBe(0);
  });
});
