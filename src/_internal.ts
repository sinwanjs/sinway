/**
 * Sinway — Internal reactive proxy machinery
 *
 * Provides property-level reactive proxies backed by signals.
 * Each property on a store target gets a Signal that tracks reads/writes.
 */

import { signal, batch, type Signal } from "sinwan/reactivity";

// ─── Symbols ───────────────────────────────────────────────

export const $RAW = Symbol("sinway.store.raw");
export const $PROXY = Symbol("sinway.store.proxy");
export const $IS_MUTABLE = Symbol("sinway.store.is_mutable");

// ─── Types ─────────────────────────────────────────────────

export type StoreNode = object;

// ─── Helpers ───────────────────────────────────────────────

export function isWrappable(obj: unknown): obj is object {
  if (obj == null || typeof obj !== "object") return false;
  if (
    obj instanceof Date ||
    obj instanceof RegExp ||
    obj instanceof Error ||
    obj instanceof Map ||
    obj instanceof Set ||
    obj instanceof WeakMap ||
    obj instanceof WeakSet ||
    obj instanceof Promise ||
    obj instanceof ArrayBuffer
  ) {
    return false;
  }
  return true;
}

/** WeakMap: raw object → property key → Signal */
const propertySignals = new WeakMap<
  object,
  Map<PropertyKey, Signal<unknown>>
>();

/** WeakMap: raw object → isMutable flag (propagates to children) */
const storeMutability = new WeakMap<object, boolean>();

export function ensureSignals(
  target: object,
): Map<PropertyKey, Signal<unknown>> {
  let sigs = propertySignals.get(target);
  if (!sigs) {
    sigs = new Map();
    propertySignals.set(target, sigs);
  }
  return sigs;
}

export function readProp(target: object, key: PropertyKey): unknown {
  const sigs = ensureSignals(target);
  let sig = sigs.get(key);
  if (!sig) {
    const rawValue = Reflect.get(target, key);
    sig = signal(wrapValue(rawValue, storeMutability.get(target) ?? false));
    sigs.set(key, sig);
  }
  return sig.value; // .value calls track()
}

export function writeProp(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const rawValue = unwrapValue(value);
  Reflect.set(target, key, rawValue);

  const sigs = ensureSignals(target);
  let sig = sigs.get(key);
  const wrapped = wrapValue(rawValue, storeMutability.get(target) ?? false);
  if (sig) {
    sig.value = wrapped; // .value setter calls trigger() if changed
  } else {
    sig = signal(wrapped);
    sigs.set(key, sig);
  }
}

export function deleteProp(target: object, key: PropertyKey): boolean {
  const result = Reflect.deleteProperty(target, key);
  const sigs = ensureSignals(target);
  const sig = sigs.get(key);
  if (sig) {
    sig.value = undefined;
    // Do NOT delete the signal from the map — future writes to this key
    // must update the same signal so existing subscribers are notified.
  }
  return result;
}

export function wrapValue<T>(value: T, isMutable = false): T {
  if (isWrappable(value) && !(value as any)[$PROXY]) {
    return wrap(value as object, isMutable) as T;
  }
  return value;
}

export function unwrapValue<T>(value: T): T {
  if (isWrappable(value) && (value as any)[$RAW]) {
    return (value as any)[$RAW];
  }
  return value;
}

// ─── Array mutation interception ───────────────────────────

const MUTATING_ARRAY_METHODS = [
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
];

function createArrayMethod(target: any[], methodName: string): Function {
  const original = (Array.prototype as any)[methodName];
  const isMutable = storeMutability.get(target) ?? false;
  return function (this: any, ...args: any[]) {
    return batch(() => {
      const result = original.apply(target, args);

      const node = ensureSignals(target);
      const newLength = target.length;

      // Update / create signals for all current indices
      for (let i = 0; i < newLength; i++) {
        const key = String(i);
        let sig = node.get(key);
        const wrapped = wrapValue(target[i], isMutable);
        if (sig) {
          sig.value = wrapped;
        } else {
          sig = signal(wrapped);
          node.set(key, sig);
        }
      }

      // Notify subscribers of removed indices, but keep the signals
      // so future writes to the same index update the same signal.
      for (const key of node.keys()) {
        if (
          typeof key === "string" &&
          /^\d+$/.test(key) &&
          parseInt(key, 10) >= newLength
        ) {
          const sig = node.get(key);
          if (sig) sig.value = undefined;
        }
      }

      // Update length signal
      let lenSig = node.get("length");
      if (lenSig) {
        lenSig.value = newLength;
      } else {
        node.set("length", signal(newLength));
      }

      return result;
    });
  };
}

// ─── Proxy factory ─────────────────────────────────────────

export function wrap<T extends object>(target: T, isMutable = false): T {
  if (!isWrappable(target)) return target;
  if ((target as any)[$PROXY]) return (target as any)[$PROXY];

  storeMutability.set(target, isMutable);

  const proxy = new Proxy(target, {
    get(t, key, receiver) {
      if (key === $PROXY) return proxy;
      if (key === $RAW) return t;
      if (key === $IS_MUTABLE) return isMutable;

      // Handle getter descriptors natively so `this` binds to the proxy
      const desc = Reflect.getOwnPropertyDescriptor(t, key);
      if (desc && "get" in desc && desc.get) {
        return desc.get.call(receiver);
      }

      // Intercept mutating array methods on mutable stores
      if (
        isMutable &&
        Array.isArray(t) &&
        typeof key === "string" &&
        MUTATING_ARRAY_METHODS.includes(key)
      ) {
        return createArrayMethod(t, key);
      }

      return readProp(t, key);
    },

    set(t, key, value, receiver) {
      if (!isMutable) {
        throw new Error(
          "Store is read-only. Use setStore() or createMutable().",
        );
      }

      const desc = Reflect.getOwnPropertyDescriptor(t, key);
      if (desc && "set" in desc && desc.set) {
        desc.set.call(receiver, value);
        // After setter runs, update signal with the getter's new return value
        const newValue = desc.get ? desc.get.call(receiver) : value;
        writeProp(t, key, newValue);
        return true;
      }

      writeProp(t, key, value);
      return true;
    },

    deleteProperty(t, key) {
      if (!isMutable) {
        throw new Error("Store is read-only.");
      }
      return deleteProp(t, key);
    },

    has(t, key) {
      if (key === $PROXY || key === $RAW || key === $IS_MUTABLE) return true;
      return Reflect.has(t, key);
    },

    ownKeys(t) {
      return Reflect.ownKeys(t);
    },

    getOwnPropertyDescriptor(t, key) {
      return Reflect.getOwnPropertyDescriptor(t, key);
    },
  });

  return proxy as T;
}

// ─── Signal sync after raw mutation ────────────────────────

/**
 * After the raw backing object has been mutated directly (e.g. by setStore
 * or modifyMutable), re-scan the object tree and update any signals whose
 * underlying value changed.
 *
 * This is run inside batch() so multiple updates trigger effects once.
 */
export function syncStoreFromRaw(root: unknown): void {
  batch(() => {
    syncNode(root);
  });
}

function syncNode(target: unknown): void {
  if (!isWrappable(target)) return;

  const sigs = propertySignals.get(target);
  if (!sigs) return;

  const keys = Reflect.ownKeys(target);
  const isMutable = storeMutability.get(target as object) ?? false;

  // Update existing signals
  for (const [key, sig] of sigs) {
    if (!keys.includes(key as string | symbol)) {
      // Property was deleted — notify subscribers with undefined.
      // Keep the signal so future writes notify the same subscribers.
      if (sig.peek() !== undefined) {
        sig.value = undefined;
      }
      continue;
    }

    const currentRaw = Reflect.get(target, key);
    const currentWrapped = sig.peek();

    if (isWrappable(currentRaw)) {
      if (
        isWrappable(currentWrapped) &&
        (currentWrapped as any)[$RAW] === currentRaw
      ) {
        // Same underlying object — just sync children
        syncNode(currentRaw);
      } else {
        // Replaced with a different object — re-wrap
        sig.value = wrapValue(currentRaw, isMutable);
      }
    } else {
      if (!Object.is(currentRaw, currentWrapped)) {
        sig.value = currentRaw;
      }
    }
  }

  // Add signals for brand-new properties
  for (const key of keys) {
    if (!sigs.has(key)) {
      const rawValue = Reflect.get(target, key);
      sigs.set(key, signal(wrapValue(rawValue, isMutable)));
    }
  }
}

// ─── Reconcile helper (mutates raw in place) ─────────────

/**
 * Deeply reconcile `source` into `target`, mutating `target` in place.
 * Returns `target`.
 */
export function reconcileIntoRaw(
  target: any,
  source: any,
  keyProp: string | null,
  merge: boolean,
): any {
  if (!isWrappable(target) || !isWrappable(source)) {
    return source;
  }

  if (Array.isArray(target) && Array.isArray(source)) {
    return reconcileArrays(target, source, keyProp, merge);
  }

  return reconcileObjects(target, source, keyProp, merge);
}

function reconcileObjects(
  target: any,
  source: any,
  keyProp: string | null,
  merge: boolean,
): any {
  const sourceKeys = Reflect.ownKeys(source);

  for (const k of sourceKeys) {
    const sourceVal = Reflect.get(source, k);
    if (k in target && isWrappable(target[k]) && isWrappable(sourceVal)) {
      target[k] = reconcileIntoRaw(target[k], sourceVal, keyProp, merge);
    } else {
      target[k] = sourceVal;
    }
  }

  // Remove keys not present in source (unless merging)
  if (!merge) {
    for (const k of Reflect.ownKeys(target)) {
      if (!sourceKeys.includes(k)) {
        delete target[k];
      }
    }
  }

  return target;
}

function reconcileArrays(
  target: any[],
  source: any[],
  keyProp: string | null,
  merge: boolean,
): any[] {
  if (keyProp) {
    // Key-based matching
    const targetMap = new Map<unknown, number>();
    for (let i = 0; i < target.length; i++) {
      const item = target[i];
      if (isWrappable(item) && keyProp in item) {
        targetMap.set((item as any)[keyProp], i);
      }
    }

    const newArray: any[] = [];
    const used = new Set<number>();

    for (const srcItem of source) {
      if (isWrappable(srcItem) && keyProp in srcItem) {
        const srcKey = (srcItem as any)[keyProp];
        const tIdx = targetMap.get(srcKey);
        if (tIdx !== undefined && !used.has(tIdx)) {
          used.add(tIdx);
          newArray.push(
            reconcileIntoRaw(target[tIdx], srcItem, keyProp, merge),
          );
        } else {
          newArray.push(srcItem);
        }
      } else {
        newArray.push(srcItem);
      }
    }

    target.length = 0;
    for (const item of newArray) {
      target.push(item);
    }
  } else {
    // Positional / reference matching
    let maxLen = Math.max(target.length, source.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < source.length && i < target.length) {
        target[i] = reconcileIntoRaw(target[i], source[i], keyProp, merge);
      } else if (i < source.length) {
        target.push(source[i]);
      } else {
        target.pop();
        i--; // adjust because length shrank
        maxLen--;
      }
    }
  }

  return target;
}
