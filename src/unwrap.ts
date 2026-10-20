/**
 * Sinway — unwrap
 *
 * Recursively remove store proxies and return the underlying plain data.
 */

import { $RAW, isWrappable } from "./_internal.ts";

/**
 * Remove store proxy wrapping recursively.
 *
 * Frozen objects/arrays are shallow-copied before unwrapping.
 * Mutable objects are unwrapped in place (reused).
 * Non-proxy values are returned unchanged.
 * Handles circular references safely.
 */
export function unwrap<T>(item: T): T {
  return _unwrap(item, new Set());
}

function _unwrap<T>(item: T, seen: Set<object>): T {
  if (!isWrappable(item)) return item;

  const raw = (item as any)[$RAW] ?? item;

  if (seen.has(raw)) return raw as T;
  seen.add(raw);

  if (Object.isFrozen(raw)) {
    if (Array.isArray(raw)) {
      const copy = [...raw];
      for (let i = 0; i < copy.length; i++) {
        copy[i] = _unwrap(copy[i], seen);
      }
      return copy as T;
    }
    const copy = Object.create(Object.getPrototypeOf(raw));
    for (const key of Reflect.ownKeys(raw)) {
      const desc = Reflect.getOwnPropertyDescriptor(raw, key)!;
      if ("value" in desc) {
        copy[key] = _unwrap(desc.value, seen);
      } else {
        Object.defineProperty(copy, key, desc);
      }
    }
    return copy;
  }

  // Mutable — unwrap in place
  if (Array.isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const val = (raw as any)[i];
      if (isWrappable(val) && (val as any)[$RAW]) {
        (raw as any)[i] = _unwrap(val, seen);
      }
    }
  } else if (typeof raw === "object" && raw !== null) {
    for (const key of Reflect.ownKeys(raw)) {
      const val = Reflect.get(raw, key);
      if (isWrappable(val) && (val as any)[$RAW]) {
        Reflect.set(raw, key, _unwrap(val, seen));
      }
    }
  }

  return raw as T;
}
