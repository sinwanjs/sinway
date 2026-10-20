# sinway

Fine-grained reactive stores for [Sinwan](https://sinwanjs.com) — `createStore`, middleware, persist, patches temporal undo/redo, and full json0 OT.

```ts
import { createStore, persist, temporal } from "sinway";

const [state, setState, api] = createStore(
  { count: 0 },
  persist({ name: "app" }),
  temporal({ mode: "ot", clientId: "alice", onOp: broadcast }),
);
```

Peer dependency: `sinwan` `>=2.0.0 <3.0.0` (uses `sinwan/reactivity`).

```bash
bun install
bun run typecheck
bun test
bun run build
```
