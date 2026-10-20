<div align="left">
  <table border="0" width="100%" align="center">
    <tr>
      <td width="150" align="left">
        <img src="https://avatars.githubusercontent.com/u/252437356?s=400&v=4" alt="Sinwan Logo" width="150" />
      </td>
      <td align="left">
        <h1>Sinway</h1>
        <p>Fine-grained reactive stores for Sinwan — createStore, persist, temporal undo/redo, and json0 OT.</p>
        <p>
          <a href="https://github.com/sinwanjs/sinway/stargazers"><img src="https://img.shields.io/github/stars/sinwanjs/sinway.svg?color=ffce3b&label=stars&logo=github" alt="GitHub stars" /></a>
          <a href="https://www.npmjs.com/package/sinway"><img src="https://img.shields.io/npm/dm/sinway?color=42b883&label=downloads&logo=npm" alt="NPM Downloads" /></a>
          <a href="https://www.npmjs.com/package/sinway"><img src="https://img.shields.io/npm/l/sinway?color=35495e&label=license" alt="License" /></a>
        </p>
      </td>
    </tr>
  </table>
</div>

<br clear="both" />

Sinway is the store package that used to live in `sinwan/store`. It tracks each property with Sinwan signals, so a write updates only the views that read that path.

## Why Sinway?

- **Fine-grained stores** — `createStore` returns a read-only proxy and a setter. Reads subscribe per property. Writes go through `setState`, including nested paths.
- **Same reactivity runtime** — stores call `signal` and `batch` from `sinwan/reactivity`. They do not ship a second runtime.
- **Middleware** — pass `persist`, `temporal`, or your own middleware to `createStore`, the same shape as a Zustand middleware.
- **History** — `temporal` records patches for local undo/redo, or json0 operations when `mode` is `"ot"`.
- **Sinwan 2.0** — `sinwan/store` is gone. Import stores from `sinway`.

Peer dependency: **sinwan >= 2.0.0 &lt; 3.0.0**.

## Install

```sh
npm install sinway sinwan
```

```sh
bun add sinway sinwan
```

JSX still comes from Sinwan. Use `bun-plugin-sinwan` or `vite-plugin-sinwan` so store reads in JSX stay reactive.

```jsonc
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "sinwan",
  },
}
```

## Quick Start

```tsx
import { cc } from "sinwan/component";
import { mount } from "sinwan/renderer";
import { createStore, persist, temporal } from "sinway";

const [state, setState, api] = createStore(
  { count: 0 },
  persist({ name: "counter" }),
  temporal({ limit: 50 }),
);

const Counter = cc(() => (
  <button onclick={() => setState("count", (n) => n + 1)}>
    Count: {state.count}
  </button>
));

mount(Counter, document.getElementById("app")!);

api.temporal.undo();
```

`state` is read-only. `setState({ count: 1 })` merges the top level. `setState("count", 1)` and `setState("user", "name", "Ada")` update a path.

## Persist and history

```ts
import { createStore, persist, temporal } from "sinway";

const [state, setState, api] = createStore(
  { count: 0 },
  persist({ name: "counter" }),
  temporal({
    mode: "ot",
    clientId: "alice",
    onOp: (event) => broadcast(event.op),
  }),
);

api.persist.clearStorage();
api.temporal.undo();
api.temporal.receiveRemote(remoteOp);
```

`persist` writes JSON through `localStorage` by default. Pass `storage` for another backend. `temporal({ mode: "patches" })` is local undo/redo. `mode: "ot"` uses json0 so undo stays valid when remote edits arrive.

## Features

- Store: `createStore`, `createMutable`, `modifyMutable`, `produce`, `reconcile`, `unwrap`
- Middleware: `applyMiddlewares`, `interceptSetStore`, `afterSetStore`, `interceptGetState`, `afterGetState`
- Persist: `persist`, `persistStore`, `createJSONStorage`
- History: `temporal` (`patches` or `ot`), `diff`, `applyPatches`
- json0: `diffJson0`, `applyJson0`, `invertJson0`, `transformJson0`, `composeJson0`

## Documentation

- [Documentation v1](https://sinwanjs.com)
- [Sinwan](https://github.com/sinwanjs/sinwan)

## Development

```sh
bun test
bun run typecheck
bun run build
```

## Author

Mohammed Ben Cheikh

## License

MIT
