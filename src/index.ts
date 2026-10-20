/**
 * Sinway — Public API
 *
 * Fine-grained reactive stores inspired by SolidJS stores.
 * Fully compatible with Sinwan's signal-based reactivity and
 * therefore works seamlessly with React-integration hooks.
 */

export { createMutable, modifyMutable } from "./mutable.ts";
export {
  createStore,
  applyMiddlewares,
  interceptSetStore,
  afterSetStore,
  interceptGetState,
  afterGetState,
  type Store,
  type SetStoreFunction,
  type DeepReadonly,
  type StoreApi,
  type StoreMiddleware,
  type CreateStoreOptions,
} from "./store.ts";
export { produce, reconcile } from "./modifiers.ts";
export { unwrap } from "./unwrap.ts";
export {
  createJSONStorage,
  persist,
  persistStore,
  type StateStorage,
  type StorageValue,
  type PersistStorage,
  type JsonStorageOptions,
  type PersistOptions,
  type PersistApi,
  type PersistStoreApi,
} from "./persist.ts";
export {
  temporal,
  type TemporalOptions,
  type TemporalApi,
  type TemporalStoreApi,
  type HistoryEntry,
  type OtOpEvent,
} from "./temporal.ts";
export {
  diff,
  applyPatches,
  type Patch,
  type PatchPath,
  type PatchPair,
} from "./patch.ts";
export {
  diffJson0,
  applyJson0,
  invertJson0,
  transformJson0,
  composeJson0,
  getJson0Type,
  type Json0Op,
  type Json0Component,
  type Json0Type,
  type OtSide,
} from "./ot.ts";
