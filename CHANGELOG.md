# Changelog

All notable changes to **sinway** are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/) and sinway adheres to [Semantic Versioning](https://semver.org/).

## [1.0.1] — Arrays Keep Their Methods After Writes

### Fixed

- **Store arrays lost their methods and iteration after any write.** Reading an inherited member through a store proxy (`list.find`, `list.map`, `for…of`, spread) gave it a signal, and the next `setState` (any path, or an object merge) treated it as a deleted own key and set it to `undefined`: `.find is not a function`, "Spread syntax requires …iterable". Inherited members are now returned untracked; the elements a method reads are still tracked, so effects that read an array through `.map` or `.reduce` rerun when it changes.

## [1.0.0] — Reactive Stores Extracted from Sinwan

sinway 1.0.0 is the first release of the store package that used to live in `sinwan/store`. Pair with **sinwan 2.0.0** or later. The store reads `signal` and `batch` from `sinwan/reactivity` and does not ship a second reactivity runtime.

### Added

- **`createStore`**: Solid-style `[state, setState]` store with middleware hooks (`applyMiddlewares`, `interceptSetStore`, `afterSetStore`, `interceptGetState`, `afterGetState`).
- **`createMutable` / `modifyMutable`**: mutable store wrapper.
- **`produce` / `reconcile`**: immutable update helpers.
- **`unwrap`**: read a store or mutable value without the proxy.
- **`persist` / `persistStore`**: JSON storage, including a `localStorage` adapter (`createJSONStorage`).
- **`temporal`**: undo and redo. `mode: "ot"` records json0 operations.
- **Patches**: `diff` and `applyPatches`.
- **json0 OT**: `diffJson0`, `applyJson0`, `invertJson0`, `transformJson0`, and `composeJson0` on top of `ot-json0`.

### Changed

- **Peer `sinwan` is `>=2.0.0 <3.0.0`**: Sinwan 2.0.0 removed `sinwan/store`. Apps import stores from `sinway`.
