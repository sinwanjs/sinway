/**
 * Sinway — createStore
 *
 * Creates a read-only reactive store proxy and a setter function
 * that supports top-level updates and path syntax.
 * Optional {@link StoreMiddleware}s wrap `setStore` (Zustand-style).
 */

import { batch } from "sinwan/reactivity";
import {
  $RAW,
  wrap,
  syncStoreFromRaw,
  reconcileIntoRaw,
  isWrappable,
} from "./_internal.ts";
import {
  applyMiddlewares,
  type StoreApi,
  type StoreMiddleware,
} from "./middleware.ts";

export type { StoreApi, StoreMiddleware } from "./middleware.ts";
export {
  applyMiddlewares,
  interceptSetStore,
  afterSetStore,
  interceptGetState,
  afterGetState,
} from "./middleware.ts";

// ─── Types ─────────────────────────────────────────────────

type Primitive = string | number | boolean | bigint | symbol | undefined | null;

/** Deep readonly utility that makes the store read-only at the type level. */
export type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<K, DeepReadonly<V>>
      : T extends Set<infer U>
        ? ReadonlySet<DeepReadonly<U>>
        : T extends Function
          ? T
          : { readonly [K in keyof T]: DeepReadonly<T[K]> };

/** The reactive store type — read-only at the type level. */
export type Store<T> = DeepReadonly<T>;

/** Helper: value or updater function for a given property type. */
type ValueOrUpdater<V> = V | ((prev: V) => V);

/**
 * Strongly-typed setter for a reactive store.
 * Supports top-level updates and path-based updates up to 4 levels deep.
 */
export interface SetStoreFunction<T> {
  // Top-level: partial object merge or function updater
  (setter: Partial<T> | ((prev: T) => T | Partial<T>)): void;

  // 1-level path
  <K1 extends keyof T>(key1: K1, value: ValueOrUpdater<T[K1]>): void;

  // 2-level path
  <K1 extends keyof T, K2 extends keyof T[K1]>(
    key1: K1,
    key2: K2,
    value: ValueOrUpdater<T[K1][K2]>,
  ): void;

  // 3-level path
  <K1 extends keyof T, K2 extends keyof T[K1], K3 extends keyof T[K1][K2]>(
    key1: K1,
    key2: K2,
    key3: K3,
    value: ValueOrUpdater<T[K1][K2][K3]>,
  ): void;

  // 4-level path
  <
    K1 extends keyof T,
    K2 extends keyof T[K1],
    K3 extends keyof T[K1][K2],
    K4 extends keyof T[K1][K2][K3],
  >(
    key1: K1,
    key2: K2,
    key3: K3,
    key4: K4,
    value: ValueOrUpdater<T[K1][K2][K3][K4]>,
  ): void;

  // Fallback for deeper paths or dynamic keys
  (...path: [...PropertyKey[], unknown]): void;
}

export type CreateStoreOptions = {
  name?: string;
};

/** Prevent middleware args from widening `T` inferred from initial state (TS 5.4+). */
type NoInferStore<T> = [T][T extends unknown ? 0 : never];

// ─── Implementation ──────────────────────────────────────

/**
 * Create a reactive store and its setter.
 *
 * The store proxy is read-only — writes must go through `setStore`.
 * Property reads track at the property level (fine-grained).
 *
 * Pass {@link StoreMiddleware} functions after the initial state (and optional
 * `{ name }`) to compose behavior — same idea as Zustand middlewares:
 *
 * @example
 * ```ts
 * const [state, setState, api] = createStore(
 *   { count: 0 },
 *   persist({ name: "counter" }),
 *   logger(),
 * );
 * ```
 */
export function createStore<T extends object = {}>(
  store?: T | Store<T>,
  options?: CreateStoreOptions,
  ...middlewares: StoreMiddleware<NoInferStore<T>>[]
): [Store<T>, SetStoreFunction<T>, StoreApi<T>];
export function createStore<T extends object = {}>(
  store: T | Store<T> | undefined,
  middleware: StoreMiddleware<NoInferStore<T>>,
  ...middlewares: StoreMiddleware<NoInferStore<T>>[]
): [Store<T>, SetStoreFunction<T>, StoreApi<T>];
export function createStore<T extends object = {}>(
  store?: T | Store<T>,
  optionsOrMiddleware?: CreateStoreOptions | StoreMiddleware<T>,
  ...rest: StoreMiddleware<T>[]
): [Store<T>, SetStoreFunction<T>, StoreApi<T>] {
  let name: string | undefined;
  const middlewares: StoreMiddleware<T>[] = [];

  if (isStoreMiddleware<T>(optionsOrMiddleware)) {
    middlewares.push(optionsOrMiddleware, ...rest);
  } else {
    name = optionsOrMiddleware?.name;
    middlewares.push(...rest);
  }

  const raw: T =
    store != null ? readInitialRaw(store) : ({} as T);
  const proxy = wrap(raw, false) as Store<T>;

  function setStore(...args: unknown[]): void {
    if (args.length === 1) {
      const arg = args[0];

      if (typeof arg === "function") {
        const result = (arg as (prev: T) => T | Partial<T>)(raw);
        batch(() => {
          if (isWrappable(result) && !Array.isArray(result)) {
            for (const key of Reflect.ownKeys(result)) {
              Reflect.set(raw as object, key, Reflect.get(result as object, key));
            }
          } else {
            if (Array.isArray(raw)) {
              (raw as unknown[]).length = 0;
              for (const item of result as unknown[]) {
                (raw as unknown[]).push(item);
              }
            } else {
              for (const key of Reflect.ownKeys(raw as object)) {
                delete (raw as Record<PropertyKey, unknown>)[key];
              }
              for (const key of Reflect.ownKeys(result as object)) {
                (raw as Record<PropertyKey, unknown>)[key] = Reflect.get(
                  result as object,
                  key,
                );
              }
            }
          }
          syncStoreFromRaw(raw);
        });
      } else if (isWrappable(arg)) {
        batch(() => {
          reconcileIntoRaw(raw, arg, "id", true);
          syncStoreFromRaw(raw);
        });
      } else {
        throw new Error(
          "setStore argument must be an object or a function modifier.",
        );
      }
    } else {
      const path = args.slice(0, -1);
      const value = args[args.length - 1];
      setPath(raw, path as PropertyKey[], value);
      syncStoreFromRaw(raw);
    }
  }

  const api: StoreApi<T> = {
    store: proxy,
    setStore: setStore as SetStoreFunction<T>,
    getState: () => raw,
    name,
  };

  applyMiddlewares(api, middlewares);

  return [api.store, api.setStore, api];
}

// ─── Path navigation ───────────────────────────────────────

function isStoreMiddleware<T extends object>(
  value: CreateStoreOptions | StoreMiddleware<T> | undefined,
): value is StoreMiddleware<T> {
  return typeof value === "function";
}

function readInitialRaw<T extends object>(store: T | Store<T>): T {
  const candidate = store as T & { [$RAW]?: T };
  const raw = candidate[$RAW];
  if (raw !== undefined) return raw;
  return store as T;
}

function setPath(target: object, path: PropertyKey[], value: unknown): void {
  let current: Record<PropertyKey, unknown> = target as Record<
    PropertyKey,
    unknown
  >;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    let next = current[key];
    if (!isWrappable(next)) {
      current[key] = {};
      next = current[key];
    }
    current = next as Record<PropertyKey, unknown>;
  }

  const lastKey = path[path.length - 1];

  if (typeof value === "function") {
    const prev = current[lastKey];
    current[lastKey] = (value as (prev: unknown) => unknown)(prev);
  } else {
    current[lastKey] = value;
  }
}
