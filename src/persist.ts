/**
 * Sinway — Persist
 *
 * Zustand-inspired localStorage persistence for `createStore`.
 * @see https://zustand.docs.pmnd.rs/reference/middlewares/persist
 */

import {
  createStore,
  interceptSetStore,
  type SetStoreFunction,
  type Store,
  type StoreApi,
  type StoreMiddleware,
} from "./store.ts";
import { $RAW } from "./_internal.ts";

/** Web Storage–compatible string adapter (localStorage, sessionStorage, memory). */
export interface StateStorage {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => unknown;
  removeItem: (name: string) => unknown;
}

/** Serialized envelope written to storage. */
export type StorageValue<S> = {
  state: S;
  version?: number;
};

/** Typed persist backend (usually from {@link createJSONStorage}). */
export interface PersistStorage<S> {
  getItem: (
    name: string,
  ) => StorageValue<S> | null | Promise<StorageValue<S> | null>;
  setItem: (name: string, value: StorageValue<S>) => unknown;
  removeItem: (name: string) => unknown;
}

export type JsonStorageOptions = {
  reviver?: (key: string, value: unknown) => unknown;
  replacer?: (key: string, value: unknown) => unknown;
};

/**
 * Build a JSON {@link PersistStorage} from a lazy storage getter.
 * The getter runs once on first use so SSR module eval does not touch
 * `localStorage` before it exists.
 */
export function createJSONStorage<S>(
  getStorage: () => StateStorage,
  options?: JsonStorageOptions,
): PersistStorage<S> | undefined {
  let storage: StateStorage | undefined;
  try {
    storage = getStorage();
  } catch {
    return undefined;
  }
  if (storage == null) return undefined;

  return {
    getItem: (name) => {
      const parse = (str: string | null): StorageValue<S> | null => {
        if (str === null) return null;
        return JSON.parse(str, options?.reviver) as StorageValue<S>;
      };
      const str = storage.getItem(name) ?? null;
      if (str instanceof Promise) {
        return str.then(parse);
      }
      return parse(str);
    },
    setItem: (name, value) =>
      storage.setItem(name, JSON.stringify(value, options?.replacer)),
    removeItem: (name) => storage.removeItem(name),
  };
}

export interface PersistOptions<S extends object, PersistedState = S> {
  /** Unique storage key. */
  name: string;
  /**
   * Persist backend. Defaults to `createJSONStorage(() => localStorage)`.
   * Pass `undefined` / omit when storage is unavailable (SSR).
   */
  storage?: PersistStorage<PersistedState> | undefined;
  /** Pick fields to save. Defaults to the full state. */
  partialize?: (state: S) => PersistedState;
  /**
   * Called before rehydration. Return a callback invoked after success or error.
   */
  onRehydrateStorage?: (
    state: S,
  ) => ((state?: S, error?: unknown) => void) | void;
  /** Bump when the persisted shape breaks; pair with {@link migrate}. */
  version?: number;
  /** Transform an older persisted payload when `version` mismatches. */
  migrate?: (
    persistedState: unknown,
    version: number,
  ) => PersistedState | Promise<PersistedState>;
  /**
   * Combine stored state with the current in-memory state.
   * Defaults to a shallow merge: `{ ...current, ...persisted }`.
   */
  merge?: (persistedState: unknown, currentState: S) => S;
  /**
   * When true, skip the initial hydrate so the app can call `rehydrate()` later
   * (useful for SSR).
   */
  skipHydration?: boolean;
}

export interface PersistApi<S extends object> {
  setOptions: <NextPersisted = unknown>(
    options: Partial<PersistOptions<S, NextPersisted>>,
  ) => void;
  clearStorage: () => void;
  rehydrate: () => Promise<void> | void;
  hasHydrated: () => boolean;
  onHydrate: (fn: (state: S) => void) => () => void;
  onFinishHydration: (fn: (state: S) => void) => () => void;
  getOptions: () => PersistOptions<S, unknown>;
}

function readRaw<T extends object>(store: Store<T>): T {
  return (store as object as Record<symbol, T>)[$RAW];
}

function snapshotState<T extends object>(store: Store<T>): T {
  return JSON.parse(JSON.stringify(readRaw(store))) as T;
}

function defaultLocalStorage(): PersistStorage<unknown> | undefined {
  const g = globalThis as { localStorage?: StateStorage };
  if (g.localStorage == null) return undefined;
  return createJSONStorage(() => g.localStorage as StateStorage);
}

function defaultPartialize<T extends object>(state: T): T {
  return state;
}

function defaultMerge<T extends object>(
  persistedState: unknown,
  currentState: T,
): T {
  return {
    ...currentState,
    ...(persistedState as object),
  };
}

/** Store APIs that include the persist control plane. */
export type PersistStoreApi<T extends object> = StoreApi<T> & {
  persist: PersistApi<T>;
};

/**
 * Zustand-style persist middleware for {@link createStore}.
 *
 * @example
 * ```ts
 * const [state, setState, api] = createStore(
 *   { count: 0 },
 *   persist({ name: "food-storage" }),
 * );
 * api.persist.clearStorage();
 * ```
 */
export function persist<
  T extends object,
  PersistedState extends object = T,
>(
  baseOptions: PersistOptions<T, PersistedState>,
): StoreMiddleware<T> {
  return (api) => {
    let options: PersistOptions<T, PersistedState> = {
      version: 0,
      ...baseOptions,
      storage:
        baseOptions.storage !== undefined
          ? baseOptions.storage
          : (defaultLocalStorage() as
              | PersistStorage<PersistedState>
              | undefined),
      partialize:
        baseOptions.partialize ??
        (defaultPartialize as (state: T) => PersistedState),
      merge: baseOptions.merge ?? defaultMerge,
    };

    let hasHydrated = false;
    let hydrationVersion = 0;
    const hydrationListeners = new Set<(state: T) => void>();
    const finishHydrationListeners = new Set<(state: T) => void>();
    let storage = options.storage;

    const getCurrent = (): T => api.getState();
    const baseSetStore = api.setStore;

    const setItem = (): unknown => {
      const state = options.partialize!(snapshotState(api.store));
      return storage!.setItem(options.name, {
        state,
        version: options.version,
      });
    };

    interceptSetStore(api, (next) => {
      next();
      if (!storage) {
        console.warn(
          `[sinwan persist] Unable to update item '${options.name}', storage is unavailable.`,
        );
        return;
      }
      void setItem();
    });

    const hydrate = (): Promise<void> | void => {
      if (!storage) {
        hasHydrated = true;
        finishHydrationListeners.forEach((cb) => cb(getCurrent()));
        return;
      }

      const currentVersion = ++hydrationVersion;
      hasHydrated = false;
      hydrationListeners.forEach((cb) => cb(getCurrent()));

      const postRehydrationCallback =
        options.onRehydrateStorage?.(getCurrent()) ?? undefined;

      return (async () => {
        try {
          const deserialized = await storage!.getItem(options.name);
          if (currentVersion !== hydrationVersion) return;

          let migrated = false;
          let migratedState: PersistedState | undefined;

          if (deserialized) {
            if (
              typeof deserialized.version === "number" &&
              deserialized.version !== options.version
            ) {
              if (options.migrate) {
                migratedState = await options.migrate(
                  deserialized.state,
                  deserialized.version,
                );
                migrated = true;
              } else {
                console.error(
                  `[sinwan persist] State for '${options.name}' could not be migrated (no migrate).`,
                );
              }
            } else {
              migratedState = deserialized.state;
            }
          }

          if (currentVersion !== hydrationVersion) return;

          if (migratedState !== undefined) {
            const merged = options.merge!(migratedState, getCurrent());
            (baseSetStore as (v: Partial<T>) => void)(merged);
            if (migrated) {
              setItem();
            }
          }

          if (currentVersion !== hydrationVersion) return;

          postRehydrationCallback?.(getCurrent(), undefined);
          hasHydrated = true;
          finishHydrationListeners.forEach((cb) => cb(getCurrent()));
        } catch (e: unknown) {
          if (currentVersion !== hydrationVersion) return;
          postRehydrationCallback?.(undefined, e);
          hasHydrated = true;
          finishHydrationListeners.forEach((cb) => cb(getCurrent()));
        }
      })();
    };

    const persistApi: PersistApi<T> = {
      setOptions: (newOptions) => {
        options = { ...options, ...newOptions } as PersistOptions<
          T,
          PersistedState
        >;
        if (newOptions.storage !== undefined) {
          storage = newOptions.storage as unknown as
            | PersistStorage<PersistedState>
            | undefined;
        }
      },
      clearStorage: () => {
        ++hydrationVersion;
        storage?.removeItem(options.name);
      },
      getOptions: () => options as PersistOptions<T, unknown>,
      rehydrate: () => hydrate(),
      hasHydrated: () => hasHydrated,
      onHydrate: (cb) => {
        hydrationListeners.add(cb);
        return () => {
          hydrationListeners.delete(cb);
        };
      },
      onFinishHydration: (cb) => {
        finishHydrationListeners.add(cb);
        return () => {
          finishHydrationListeners.delete(cb);
        };
      },
    };

    (api as PersistStoreApi<T>).persist = persistApi;

    if (!options.skipHydration) {
      void hydrate();
    }
  };
}

/**
 * Convenience: `createStore(initial, persist(options))` returning the persist API.
 *
 * @example
 * ```ts
 * const [bears, setBears, persistApi] = persistStore(
 *   { count: 0 },
 *   { name: "food-storage" },
 * );
 * setBears("count", (n) => n + 1);
 * ```
 */
export function persistStore<
  T extends object,
  PersistedState extends object = T,
>(
  initial: T,
  baseOptions: PersistOptions<T, PersistedState>,
): [Store<T>, SetStoreFunction<T>, PersistApi<T>] {
  const [store, setStore, api] = createStore(
    initial,
    persist(baseOptions),
  );
  return [store, setStore, (api as PersistStoreApi<T>).persist];
}
