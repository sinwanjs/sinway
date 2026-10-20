/**
 * Tests for temporal patches undo/redo middleware.
 */

import { describe, expect, it } from "bun:test";
import {
  createStore,
  createJSONStorage,
  persist,
  temporal,
  type TemporalStoreApi,
  type StateStorage,
} from "../src/index.ts";

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

describe("temporal middleware", () => {
  it("undoes and redoes setStore updates", () => {
    const [state, setState, api] = createStore(
      { count: 0, label: "a" },
      temporal(),
    );
    const t = (api as TemporalStoreApi<{ count: number; label: string }>)
      .temporal;

    setState("count", 1);
    setState("label", "b");
    expect(state.count).toBe(1);
    expect(state.label).toBe("b");
    expect(t.canUndo()).toBe(true);

    t.undo();
    expect(state.label).toBe("a");
    expect(state.count).toBe(1);
    expect(t.canRedo()).toBe(true);
    expect(t.getFuture().length).toBe(1);

    t.undo();
    expect(state.count).toBe(0);

    t.redo();
    expect(state.count).toBe(1);
    t.redo();
    expect(state.label).toBe("b");
    expect(t.canRedo()).toBe(false);
  });

  it("clears future on a new edit after undo", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal());
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 1);
    setState("n", 2);
    t.undo();
    expect(t.canRedo()).toBe(true);
    setState("n", 9);
    expect(t.canRedo()).toBe(false);
    expect(api.getState().n).toBe(9);
  });

  it("respects limit by dropping oldest past entries", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal({ limit: 2 }));
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 1);
    setState("n", 2);
    setState("n", 3);
    expect(t.getPast().length).toBe(2);
    t.undo();
    t.undo();
    expect(api.getState().n).toBe(1);
    expect(t.canUndo()).toBe(false);
  });

  it("partializes tracked state", () => {
    type S = { count: number; noise: number };
    const [state, setState, api] = createStore(
      { count: 0, noise: 0 },
      temporal<S>({ partialize: (s) => ({ count: s.count }) }),
    );
    const t = (api as TemporalStoreApi<S>).temporal;
    setState("noise", 5);
    expect(t.canUndo()).toBe(false);
    setState("count", 2);
    expect(t.canUndo()).toBe(true);
    t.undo();
    expect(state.count).toBe(0);
    expect(state.noise).toBe(5);
  });

  it("pause and resume skip recording", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal());
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    t.pause();
    setState("n", 1);
    expect(t.canUndo()).toBe(false);
    t.resume();
    setState("n", 2);
    expect(t.canUndo()).toBe(true);
    t.undo();
    expect(api.getState().n).toBe(1);
  });

  it("transactions coalesce multiple writes into one undo step", () => {
    const [state, setState, api] = createStore(
      { a: 0, b: 0 },
      temporal(),
    );
    const t = (api as TemporalStoreApi<{ a: number; b: number }>).temporal;
    t.beginTransaction();
    setState("a", 1);
    setState("b", 2);
    t.endTransaction();
    expect(state.a).toBe(1);
    expect(state.b).toBe(2);
    expect(t.getPast().length).toBe(1);
    t.undo();
    expect(state.a).toBe(0);
    expect(state.b).toBe(0);
  });

  it("supports nested transactions", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal());
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    t.beginTransaction();
    setState("n", 1);
    t.beginTransaction();
    setState("n", 2);
    t.endTransaction();
    setState("n", 3);
    t.endTransaction();
    expect(t.getPast().length).toBe(1);
    t.undo();
    expect(api.getState().n).toBe(0);
  });

  it("clear resets history and open transactions", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal());
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 1);
    t.beginTransaction();
    setState("n", 2);
    t.clear();
    expect(t.canUndo()).toBe(false);
    expect(t.canRedo()).toBe(false);
    t.endTransaction();
    expect(t.canUndo()).toBe(false);
  });

  it("undo/redo no-op when stacks are empty", () => {
    const [, , api] = createStore({ n: 0 }, temporal());
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    t.undo();
    t.redo();
    expect(api.getState().n).toBe(0);
  });

  it("custom equality can skip recording", () => {
    const [, setState, api] = createStore(
      { n: 0 },
      temporal({ equality: () => true }),
    );
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 1);
    expect(t.canUndo()).toBe(false);
  });

  it("composes with persist (temporal outer)", () => {
    const memory = createMemoryStorage();
    const storage = createJSONStorage<{ n: number }>(() => memory)!;
    const [state, setState, api] = createStore(
      { n: 0 },
      persist({ name: "t", storage, skipHydration: true }),
      temporal(),
    );
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 4);
    expect(JSON.parse(memory.getItem("t") as string).state.n).toBe(4);
    t.undo();
    expect(state.n).toBe(0);
    expect(JSON.parse(memory.getItem("t") as string).state.n).toBe(0);
  });

  it("exposes options on the temporal api", () => {
    const opts = { limit: 3 };
    const [, , api] = createStore({ n: 0 }, temporal(opts));
    expect(
      (api as TemporalStoreApi<{ n: number }>).temporal.options,
    ).toBe(opts);
  });

  it("endTransaction is a no-op without begin", () => {
    const [, , api] = createStore({ n: 0 }, temporal());
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    t.endTransaction();
    expect(t.canUndo()).toBe(false);
  });

  it("skips transaction commit while paused", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal());
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    t.beginTransaction();
    setState("n", 1);
    t.pause();
    t.endTransaction();
    expect(t.canUndo()).toBe(false);
  });

  it("default equality treats circular snapshots as unequal then diff throws", () => {
    let tick = 0;
    const [, setState, api] = createStore(
      { n: 0 },
      temporal({
        partialize: () => {
          const c: Record<string, unknown> = { tick: tick++ };
          c.self = c;
          return c;
        },
      }),
    );
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    expect(() => setState("n", 1)).toThrow();
    expect(t.getPast().length).toBe(0);
  });
});
