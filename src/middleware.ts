/**
 * Sinway — Middleware types and helpers
 *
 * Zustand-style middlewares for `createStore`: a middleware receives the live
 * {@link StoreApi} and may wrap `setStore` or attach extra fields (e.g. persist).
 */

import type { SetStoreFunction, Store } from "./store.ts";

/**
 * Mutable store handle passed to middlewares.
 * Middlewares typically replace `setStore` and may attach extras on the object.
 */
export interface StoreApi<T extends object> {
  /** Reactive read proxy. */
  store: Store<T>;
  /** Write entry point — middlewares wrap this in place. */
  setStore: SetStoreFunction<T>;
  /** Plain current state (raw, not proxied). */
  getState: () => T;
  /** Optional debug name from `createStore` options. */
  name?: string;
}

/**
 * A store middleware. Runs once after the base store is created.
 *
 * Prefer {@link interceptSetStore} / {@link afterSetStore} for writes and
 * {@link interceptGetState} for snapshot reads — those helpers hide wiring.
 *
 * Parameter is bivariant so factories like `persist()` / `temporal()` that
 * default to `object` remain assignable when composed with a concrete store.
 *
 * @example
 * ```ts
 * const logger: StoreMiddleware<{ count: number }> = (api) => {
 *   afterSetStore(api, () => {
 *     console.log(api.getState());
 *   });
 * };
 * ```
 */
export type StoreMiddleware<T extends object> = {
  bivarianceHack(api: StoreApi<T>): void;
}["bivarianceHack"];

/**
 * Callable view of {@link SetStoreFunction} used only inside wrap helpers.
 * Overloads are preserved via intersection; `never[]` is the safe spread form.
 */
type SetStoreCaller<T extends object> = SetStoreFunction<T> &
  ((...args: never[]) => void);

/**
 * Wrap `api.setStore` without `unknown[]` casts at the call site.
 *
 * Call `next()` to run the previous setter (with the original arguments).
 *
 * @example
 * ```ts
 * interceptSetStore(api, (next) => {
 *   console.log("before", api.getState());
 *   next();
 *   console.log("after", api.getState());
 * });
 * ```
 */
export function interceptSetStore<T extends object>(
  api: StoreApi<T>,
  intercept: (next: () => void) => void,
): void {
  const base = api.setStore as SetStoreCaller<T>;
  api.setStore = ((...args: never[]) => {
    intercept(() => {
      base(...args);
    });
  }) as SetStoreFunction<T>;
}

/**
 * Run a callback after every successful `setStore` call.
 *
 * @example
 * ```ts
 * afterSetStore(api, () => {
 *   console.log(api.getState());
 * });
 * ```
 */
export function afterSetStore<T extends object>(
  api: StoreApi<T>,
  after: () => void,
): void {
  interceptSetStore(api, (next) => {
    next();
    after();
  });
}

/**
 * Wrap `api.getState()` (plain snapshot reads).
 *
 * Call `next()` to get the previous snapshot; return the value callers should see
 * (same or transformed).
 *
 * Note: reactive UI reads use `api.store.prop`, not `getState`. This only wraps
 * the snapshot helper — same role as Zustand's `get`.
 *
 * @example
 * ```ts
 * interceptGetState(api, (next) => {
 *   const state = next();
 *   console.log("get", state);
 *   return state;
 * });
 * ```
 */
export function interceptGetState<T extends object>(
  api: StoreApi<T>,
  intercept: (next: () => T) => T,
): void {
  const base = api.getState;
  api.getState = () => intercept(() => base());
}

/**
 * Run a callback after every `getState()` call (does not change the value).
 */
export function afterGetState<T extends object>(
  api: StoreApi<T>,
  after: (state: T) => void,
): void {
  interceptGetState(api, (next) => {
    const state = next();
    after(state);
    return state;
  });
}

/**
 * Apply middlewares left-to-right. Later middlewares wrap earlier `setStore`
 * replacements, so the last middleware is outermost (sees each update first).
 */
export function applyMiddlewares<T extends object>(
  api: StoreApi<T>,
  middlewares: readonly StoreMiddleware<T>[],
): StoreApi<T> {
  for (const middleware of middlewares) {
    middleware(api);
  }
  return api;
}
