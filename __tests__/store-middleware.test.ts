/**
 * Tests for store middleware composition.
 */

import { describe, expect, it, mock } from "bun:test";
import {
  afterGetState,
  afterSetStore,
  applyMiddlewares,
  createStore,
  interceptGetState,
  interceptSetStore,
  persist,
  type PersistStoreApi,
  type StoreApi,
  type StoreMiddleware,
} from "../src/index.ts";
import { createJSONStorage, type StateStorage } from "../src/persist.ts";

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

describe("store middlewares", () => {
  it("applyMiddlewares runs left-to-right with last outermost", () => {
    const order: string[] = [];
    const api = {
      store: {} as StoreApi<{ n: number }>["store"],
      setStore: ((..._args: never[]) => {
        order.push("base");
      }) as StoreApi<{ n: number }>["setStore"],
      getState: () => ({ n: 0 }),
    };
    const a: StoreMiddleware<{ n: number }> = (inner) => {
      interceptSetStore(inner, (next) => {
        order.push("a");
        next();
      });
    };
    const b: StoreMiddleware<{ n: number }> = (inner) => {
      interceptSetStore(inner, (next) => {
        order.push("b");
        next();
      });
    };
    applyMiddlewares(api, [a, b]);
    api.setStore("n", 1);
    expect(order).toEqual(["b", "a", "base"]);
  });

  it("createStore accepts middleware without options object", () => {
    const seen: number[] = [];
    const logger: StoreMiddleware<{ count: number }> = (api) => {
      afterSetStore(api, () => {
        seen.push(api.getState().count);
      });
    };
    const [state, setState, api] = createStore({ count: 0 }, logger);
    setState("count", 2);
    expect(state.count).toBe(2);
    expect(seen).toEqual([2]);
    expect(api.getState().count).toBe(2);
  });

  it("createStore accepts options then middlewares", () => {
    const logger: StoreMiddleware<{ count: number }> = (api) => {
      afterSetStore(api, () => {});
    };
    const [, , api] = createStore({ count: 0 }, { name: "counter" }, logger);
    expect(api.name).toBe("counter");
  });

  it("composes persist middleware with a logger", async () => {
    const memory = createMemoryStorage({
      mw: JSON.stringify({ state: { count: 5 }, version: 0 }),
    });
    const storage = createJSONStorage<{ count: number }>(() => memory)!;
    const logs: number[] = [];
    const logger: StoreMiddleware<{ count: number }> = (api) => {
      afterSetStore(api, () => {
        logs.push(api.getState().count);
      });
    };

    const [state, setState, api] = createStore(
      { count: 0 },
      persist({ name: "mw", storage, skipHydration: true }),
      logger,
    );

    await (api as PersistStoreApi<{ count: number }>).persist.rehydrate();
    expect(state.count).toBe(5);

    setState("count", 6);
    expect(logs).toEqual([6]);
    expect(JSON.parse(memory.getItem("mw") as string)).toEqual({
      state: { count: 6 },
      version: 0,
    });
  });

  it("logger middleware can observe updates via mock", () => {
    const onSet = mock((_state: { count: number }) => {});
    const logger: StoreMiddleware<{ count: number }> = (api) => {
      afterSetStore(api, () => {
        onSet(api.getState());
      });
    };
    const [, setState] = createStore({ count: 0 }, logger);
    setState({ count: 1 });
    expect(onSet).toHaveBeenCalledWith({ count: 1 });
  });

  it("interceptSetStore can run logic before next()", () => {
    const steps: string[] = [];
    const mw: StoreMiddleware<{ count: number }> = (api) => {
      interceptSetStore(api, (next) => {
        steps.push("before");
        next();
        steps.push("after");
      });
    };
    const [, setState] = createStore({ count: 0 }, mw);
    setState("count", 1);
    expect(steps).toEqual(["before", "after"]);
  });

  it("interceptGetState wraps snapshot reads", () => {
    const seen: number[] = [];
    const mw: StoreMiddleware<{ count: number }> = (api) => {
      interceptGetState(api, (next) => {
        const state = next();
        seen.push(state.count);
        return state;
      });
    };
    const [, setState, api] = createStore({ count: 0 }, mw);
    setState("count", 3);
    expect(api.getState().count).toBe(3);
    expect(seen).toEqual([3]);
  });

  it("afterGetState observes getState without changing it", () => {
    const onGet = mock((_count: number) => {});
    const mw: StoreMiddleware<{ count: number }> = (api) => {
      afterGetState(api, (state) => {
        onGet(state.count);
      });
    };
    const [, , api] = createStore({ count: 7 }, mw);
    expect(api.getState().count).toBe(7);
    expect(onGet).toHaveBeenCalledWith(7);
  });
});
