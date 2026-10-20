/**
 * Sinway — Mutable Store
 *
 * createMutable: writable reactive proxy (both reads and writes reactive).
 * modifyMutable: apply a modifier inside a batch.
 */

import { batch } from "sinwan/reactivity";
import {
  $RAW,
  wrap,
  syncStoreFromRaw,
  reconcileIntoRaw,
  type StoreNode,
} from "./_internal.ts";

/**
 * Create a mutable reactive store proxy.
 *
 * Reads track dependencies at the property level.
 * Writes trigger dependents.
 * Array mutator methods are batched.
 */
export function createMutable<T extends StoreNode>(
  state: T,
  _options?: { name?: string },
): T {
  return wrap(state, true);
}

/**
 * Apply a modifier to a mutable store inside a batch.
 *
 * The modifier receives the unwrapped underlying state object.
 * For direct mutation-style modifiers the return value is ignored.
 * When a modifier returns a different object (e.g. produce) the
 * result is reconciled back into the mutable store in place.
 */
export function modifyMutable<T extends object>(
  state: T,
  modifier: (state: T) => T,
): void {
  const raw = (state as any)[$RAW] ?? state;
  batch(() => {
    const result = modifier(raw as T);
    if (result !== raw) {
      // Modifier returned a new object (e.g. produce) — reconcile it
      // with merge=false so deletions in the result are honored.
      reconcileIntoRaw(raw, result, null, false);
    }
    syncStoreFromRaw(raw);
  });
}
