/**
 * Sinway — Temporal (patches + full OT undo/redo)
 *
 * - `mode: "patches"` (default): local dual-stack of forward/inverse patches.
 * - `mode: "ot"`: json0 ops with transform-on-remote and collaborative undo
 *   (invert → already kept in current coords via stack transforms; undo/redo
 *   broadcast as new ops).
 *
 * @see sinwan-agent/sinwan/temporal-patches-undo-redo.md
 * @see sinwan-agent/sinwan/temporal-full-ot.md
 */

import { applyPatches, diff, type Patch } from "./patch.ts";
import {
  applyJson0,
  cloneJson0Op,
  diffJson0,
  invertJson0,
  transformJson0,
  transformStackBy,
  type Json0Op,
} from "./ot.ts";
import { interceptSetStore, type StoreApi, type StoreMiddleware } from "./store.ts";

export type HistoryEntry = {
  patches: Patch[];
  inversePatches: Patch[];
  /** Present in `mode: "ot"`. */
  op?: Json0Op;
  /** Present in `mode: "ot"` — inverse at the time of recording (pre-transform). */
  inverseOp?: Json0Op;
  id?: string;
  clientId?: string;
};

export type OtOpEvent = {
  id: string;
  clientId: string;
  op: Json0Op;
  /** Why this op was produced. */
  kind: "edit" | "undo" | "redo";
};

export type TemporalOptions<T extends object> = {
  /**
   * History engine.
   * - `patches` — local-only RFC-style patches (default).
   * - `ot` — full json0 OT with `receiveRemote` + transform-aware undo.
   */
  mode?: "patches" | "ot";
  /** Max past entries retained (oldest dropped). Default 100. */
  limit?: number;
  /** Slice of state to track. Defaults to full getState() JSON snapshot. */
  partialize?: (state: T) => unknown;
  /** Skip recording when equal (default: JSON stringify compare). */
  equality?: (a: unknown, b: unknown) => boolean;
  /** Stable id for this client (OT mode). Default: random. */
  clientId?: string;
  /** Called after a local OT op is applied (edit / undo / redo) for broadcast. */
  onOp?: (event: OtOpEvent) => void;
};

export type TemporalApi<T extends object> = {
  undo: () => void;
  redo: () => void;
  clear: () => void;
  pause: () => void;
  resume: () => void;
  beginTransaction: () => void;
  endTransaction: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getPast: () => readonly HistoryEntry[];
  getFuture: () => readonly HistoryEntry[];
  options: TemporalOptions<T>;
  /** OT client id (always defined; random if not configured). */
  getClientId: () => string;
  /**
   * Apply a remote json0 op (OT mode). Transforms against pending local ops,
   * applies, then transforms undo/redo stacks so undo stays correct under
   * concurrency.
   */
  receiveRemote: (
    op: Json0Op,
    meta?: { id?: string; clientId?: string },
  ) => void;
  /** Acknowledge a local op echoed from the server (removes from pending). */
  ack: (id: string) => void;
  /** Unacknowledged local ops awaiting server echo (OT mode). */
  getPending: () => readonly { id: string; op: Json0Op }[];
};

export type TemporalStoreApi<T extends object> = StoreApi<T> & {
  temporal: TemporalApi<T>;
};

function defaultPartialize<T extends object>(state: T): unknown {
  return JSON.parse(JSON.stringify(state));
}

function defaultEquality(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function createClientId(): string {
  return `c_${Math.random().toString(36).slice(2, 10)}`;
}

function createOpId(): string {
  return `o_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Undo/redo middleware for {@link createStore}.
 *
 * @example Patches (local)
 * ```ts
 * const [state, setState, api] = createStore(
 *   { count: 0 },
 *   temporal({ limit: 50 }),
 * );
 * ```
 *
 * @example Full OT (collaborative)
 * ```ts
 * const [, setState, api] = createStore(
 *   { count: 0 },
 *   temporal({
 *     mode: "ot",
 *     clientId: "alice",
 *     onOp: (e) => socket.send(e),
 *   }),
 * );
 * api.temporal.receiveRemote(remote.op, remote);
 * api.temporal.undo(); // inverse transformed against concurrent remote ops
 * ```
 */
export function temporal<T extends object>(
  options: TemporalOptions<T> = {},
): StoreMiddleware<T> {
  const mode = options.mode ?? "patches";
  if (mode === "ot") {
    return createOtTemporal(options);
  }
  return createPatchesTemporal(options);
}

function createPatchesTemporal<T extends object>(
  options: TemporalOptions<T>,
): StoreMiddleware<T> {
  return (api) => {
    const limit = options.limit ?? 100;
    const partialize = options.partialize ?? defaultPartialize;
    const equality = options.equality ?? defaultEquality;
    const clientId = options.clientId ?? createClientId();

    const past: HistoryEntry[] = [];
    const future: HistoryEntry[] = [];
    let paused = false;
    let transactionDepth = 0;
    let transactionBefore: unknown | undefined;

    const snapshot = (): unknown => partialize(api.getState());

    const pushEntry = (entry: HistoryEntry): void => {
      if (entry.patches.length === 0) return;
      past.push(entry);
      future.length = 0;
      while (past.length > limit) {
        past.shift();
      }
    };

    const recordFromTo = (before: unknown, after: unknown): void => {
      if (equality(before, after)) return;
      const pair = diff(before, after);
      pushEntry(pair);
    };

    const applyEntry = (patches: Patch[]): void => {
      paused = true;
      try {
        const currentPartial = partialize(api.getState());
        const nextPartial = applyPatches(currentPartial, patches);
        api.setStore(nextPartial as Partial<T>);
      } finally {
        paused = false;
      }
    };

    interceptSetStore(api, (next) => {
      if (paused) {
        next();
        return;
      }

      if (transactionDepth > 0) {
        next();
        return;
      }

      const before = snapshot();
      next();
      const after = snapshot();
      recordFromTo(before, after);
    });

    const temporalApi: TemporalApi<T> = {
      undo: () => {
        const entry = past.pop();
        if (!entry) return;
        applyEntry(entry.inversePatches);
        future.push(entry);
      },
      redo: () => {
        const entry = future.pop();
        if (!entry) return;
        applyEntry(entry.patches);
        past.push(entry);
      },
      clear: () => {
        past.length = 0;
        future.length = 0;
        transactionBefore = undefined;
        transactionDepth = 0;
      },
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      beginTransaction: () => {
        if (transactionDepth === 0) {
          transactionBefore = snapshot();
        }
        transactionDepth += 1;
      },
      endTransaction: () => {
        if (transactionDepth === 0) return;
        transactionDepth -= 1;
        if (transactionDepth > 0) return;
        const before = transactionBefore;
        transactionBefore = undefined;
        if (before === undefined || paused) return;
        recordFromTo(before, snapshot());
      },
      canUndo: () => past.length > 0,
      canRedo: () => future.length > 0,
      getPast: () => past,
      getFuture: () => future,
      options,
      getClientId: () => clientId,
      receiveRemote: () => {
        throw new Error(
          '[sinwan temporal] receiveRemote requires mode: "ot"',
        );
      },
      ack: () => {
        throw new Error('[sinwan temporal] ack requires mode: "ot"');
      },
      getPending: () => [],
    };

    (api as TemporalStoreApi<T>).temporal = temporalApi;
  };
}

function createOtTemporal<T extends object>(
  options: TemporalOptions<T>,
): StoreMiddleware<T> {
  return (api) => {
    const limit = options.limit ?? 100;
    const partialize = options.partialize ?? defaultPartialize;
    const equality = options.equality ?? defaultEquality;
    const clientId = options.clientId ?? createClientId();
    const onOp = options.onOp;

    /** Inverse ops valid against the *current* document (continuously transformed). */
    const undoStack: Json0Op[] = [];
    const redoStack: Json0Op[] = [];
    /** Mirror history entries for getPast/getFuture introspection. */
    const past: HistoryEntry[] = [];
    const future: HistoryEntry[] = [];
    const pending: { id: string; op: Json0Op }[] = [];

    let paused = false;
    let transactionDepth = 0;
    let transactionBefore: unknown | undefined;

    const snapshot = (): unknown => partialize(api.getState());

    const trimPast = (): void => {
      while (past.length > limit) {
        past.shift();
        undoStack.shift();
      }
    };

    const applyOpToStore = (op: Json0Op): void => {
      if (op.length === 0) return;
      paused = true;
      try {
        const currentPartial = partialize(api.getState());
        const nextPartial = applyJson0(currentPartial, op);
        api.setStore(nextPartial as Partial<T>);
      } finally {
        paused = false;
      }
    };

    const pushUndoable = (op: Json0Op, id: string): void => {
      const inverseOp = invertJson0(op);
      undoStack.push(inverseOp);
      past.push({
        patches: [],
        inversePatches: [],
        op: cloneJson0Op(op),
        inverseOp: cloneJson0Op(inverseOp),
        id,
        clientId,
      });
      redoStack.length = 0;
      future.length = 0;
      trimPast();
    };

    const emit = (event: OtOpEvent): void => {
      onOp?.(event);
    };

    const submitLocal = (
      op: Json0Op,
      kind: OtOpEvent["kind"],
      undoable: boolean,
    ): void => {
      if (op.length === 0) return;
      const id = createOpId();
      if (undoable) {
        pushUndoable(op, id);
      }
      pending.push({ id, op: cloneJson0Op(op) });
      emit({ id, clientId, op: cloneJson0Op(op), kind });
    };

    const recordFromTo = (before: unknown, after: unknown): void => {
      if (equality(before, after)) return;
      const op = diffJson0(before, after);
      if (op.length === 0) return;
      // State already updated by setStore; only record + broadcast.
      submitLocal(op, "edit", true);
    };

    interceptSetStore(api, (next) => {
      if (paused) {
        next();
        return;
      }

      if (transactionDepth > 0) {
        next();
        return;
      }

      const before = snapshot();
      next();
      const after = snapshot();
      recordFromTo(before, after);
    });

    const resyncMirrors = (): void => {
      past.length = 0;
      for (const inv of undoStack) {
        past.push({
          patches: [],
          inversePatches: [],
          inverseOp: cloneJson0Op(inv),
          op: invertJson0(inv),
          clientId,
        });
      }
      future.length = 0;
      for (const fwd of redoStack) {
        future.push({
          patches: [],
          inversePatches: [],
          op: cloneJson0Op(fwd),
          inverseOp: invertJson0(fwd),
          clientId,
        });
      }
    };

    const transformStacks = (by: Json0Op): void => {
      transformStackBy(undoStack, by, "left");
      transformStackBy(redoStack, by, "left");
      resyncMirrors();
    };

    const temporalApi: TemporalApi<T> = {
      undo: () => {
        if (undoStack.length === 0 || past.length === 0) return;
        const inverse = undoStack.pop()!;
        const entry = past.pop()!;
        applyOpToStore(inverse);
        transformStacks(inverse);
        const redoOp = invertJson0(inverse);
        redoStack.push(redoOp);
        future.push({
          patches: [],
          inversePatches: [],
          op: cloneJson0Op(redoOp),
          inverseOp: cloneJson0Op(inverse),
          id: entry.id,
          clientId,
        });
        // If the edit is still unacked, drop it from pending — the undo cancels it.
        if (entry.id) {
          const pendingIdx = pending.findIndex((p) => p.id === entry.id);
          if (pendingIdx >= 0) {
            pending.splice(pendingIdx, 1);
          }
        }
        submitLocal(inverse, "undo", false);
      },
      redo: () => {
        if (redoStack.length === 0 || future.length === 0) return;
        const forward = redoStack.pop()!;
        const entry = future.pop()!;
        applyOpToStore(forward);
        transformStacks(forward);
        const undoOp = invertJson0(forward);
        undoStack.push(undoOp);
        past.push({
          patches: [],
          inversePatches: [],
          op: cloneJson0Op(forward),
          inverseOp: cloneJson0Op(undoOp),
          id: entry.id,
          clientId,
        });
        trimPast();
        submitLocal(forward, "redo", false);
      },
      clear: () => {
        past.length = 0;
        future.length = 0;
        undoStack.length = 0;
        redoStack.length = 0;
        pending.length = 0;
        transactionBefore = undefined;
        transactionDepth = 0;
      },
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      beginTransaction: () => {
        if (transactionDepth === 0) {
          transactionBefore = snapshot();
        }
        transactionDepth += 1;
      },
      endTransaction: () => {
        if (transactionDepth === 0) return;
        transactionDepth -= 1;
        if (transactionDepth > 0) return;
        const before = transactionBefore;
        transactionBefore = undefined;
        if (before === undefined || paused) return;
        recordFromTo(before, snapshot());
      },
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      getPast: () => past,
      getFuture: () => future,
      options,
      getClientId: () => clientId,
      receiveRemote: (op, meta = {}) => {
        if (meta.id) {
          const idx = pending.findIndex((p) => p.id === meta.id);
          if (idx >= 0) {
            pending.splice(idx, 1);
            return;
          }
        }

        let transformed = cloneJson0Op(op);
        for (const p of pending) {
          transformed = transformJson0(transformed, p.op, "left");
        }
        applyOpToStore(transformed);
        for (let i = 0; i < pending.length; i++) {
          pending[i] = {
            id: pending[i].id,
            op: transformJson0(pending[i].op, op, "right"),
          };
        }
        transformStacks(transformed);
      },
      ack: (id) => {
        const idx = pending.findIndex((p) => p.id === id);
        if (idx >= 0) pending.splice(idx, 1);
      },
      getPending: () => pending,
    };

    (api as TemporalStoreApi<T>).temporal = temporalApi;
  };
}
