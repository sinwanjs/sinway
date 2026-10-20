/**
 * Sinway — Modifiers
 *
 * produce  : Immer-style draft proxy for mutation-style updates.
 * reconcile: reconcile an incoming snapshot against existing state.
 */

import { $RAW, isWrappable, reconcileIntoRaw } from "./_internal.ts";
import { createMutable } from "./mutable.ts";
import { unwrap } from "./unwrap.ts";

// ─── produce ───────────────────────────────────────────────

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    const arr = value as any[];
    const len = arr.length;
    const clone = new Array(len);
    for (let i = 0; i < len; i++) {
      clone[i] = deepClone(arr[i]);
    }
    return clone as T;
  }
  if (value !== null && typeof value === "object") {
    const clone: any = {};
    for (const key of Reflect.ownKeys(value as object)) {
      const desc = Reflect.getOwnPropertyDescriptor(value as object, key)!;
      if ("value" in desc) {
        clone[key] = deepClone(desc.value);
      } else {
        Object.defineProperty(clone, key, desc);
      }
    }
    return clone;
  }
  return value;
}
/**
 * Create a store modifier that applies changes by mutating a draft proxy.
 *
 * Internally deep-clones the input, wraps it in a mutable store so the
 * modifier can mutate freely, then unwraps the result back to a plain
 * object so the original is never touched.
 *
 * Returns a modifier function suitable for setStore or modifyMutable.
 *
 * @example
 * setState(produce((draft) => { draft.count += 1; }));
 */
export function produce<T extends object>(
  fn: (state: T) => void,
): (state: T) => T {
  return (state: T) => {
    const raw = (state as any)[$RAW] ?? state;
    const draft = createMutable(deepClone(raw));
    fn(draft as T);
    return unwrap(draft) as T;
  };
}

// ─── reconcile ─────────────────────────────────────────────

const RECONCILE_MARK = Symbol("sinwan.reconcile");

interface ReconcileOptions {
  key?: string | null;
  merge?: boolean;
}

/**
 * Create a store modifier that reconciles existing state with a new value.
 *
 * By default array items are matched by `"id"` when possible.
 * When merge is true updates are pushed deeper; when false non-matching
 * branches are replaced.
 *
 * @example
 * setState(reconcile({ todos: newTodos }));
 * setState("todos", reconcile(newTodos, { key: "id" }));
 */
export function reconcile<T>(
  value: T,
  options?: ReconcileOptions,
): (state: T) => T {
  const modifier = (state: T): T => {
    const result = reconcileIntoRaw(
      state,
      value,
      options == null || options.key === undefined ? "id" : options.key,
      options?.merge ?? false,
    );
    return result as T;
  };
  (modifier as any)[RECONCILE_MARK] = true;
  return modifier;
}

/** Internal: check if a value is a reconcile modifier. */
export function isReconcileModifier(fn: unknown): boolean {
  return typeof fn === "function" && (fn as any)[RECONCILE_MARK] === true;
}
