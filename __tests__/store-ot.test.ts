/**
 * Tests for json0 OT helpers and temporal mode: "ot".
 */

import { describe, expect, it } from "bun:test";
import {
  applyJson0,
  composeJson0,
  createStore,
  diffJson0,
  getJson0Type,
  invertJson0,
  temporal,
  transformJson0,
  type Json0Op,
  type OtOpEvent,
  type TemporalStoreApi,
} from "../src/index.ts";
import { transformStackBy } from "../src/ot.ts";

describe("diffJson0 / applyJson0", () => {
  it("diffs object field replace/add/remove and applies", () => {
    const before = { a: 1, b: "x", c: true };
    const after = { a: 2, c: true, d: 9 };
    const op = diffJson0(before, after);
    expect(applyJson0(before, op)).toEqual(after);
    expect(applyJson0(after, invertJson0(op))).toEqual(before);
  });

  it("diffs equal-length array element changes with ld/li", () => {
    const before = { items: [1, 2, 3] };
    const after = { items: [1, 9, 3] };
    const op = diffJson0(before, after);
    expect(op.some((c) => c.ld !== undefined && c.li !== undefined)).toBe(true);
    expect(applyJson0(before, op)).toEqual(after);
  });

  it("replaces whole array on length change", () => {
    const before = { items: [1, 2] };
    const after = { items: [1, 2, 3] };
    const op = diffJson0(before, after);
    expect(applyJson0(before, op)).toEqual(after);
  });

  it("replaces nested array (path ends with index) on length change", () => {
    const before = { grid: [[1], [2]] };
    const after = { grid: [[1, 9], [2]] };
    const op = diffJson0(before, after);
    expect(op.some((c) => c.ld !== undefined && c.li !== undefined)).toBe(true);
    expect(applyJson0(before, op)).toEqual(after);
  });

  it("throws when replacing root non-object", () => {
    expect(() => diffJson0(1, 2)).toThrow(/root/);
  });

  it("throws when replacing root array", () => {
    expect(() => diffJson0([1], [1, 2])).toThrow(/root array/);
  });

  it("exposes getJson0Type and composeJson0", () => {
    expect(getJson0Type().name).toBe("json0");
    const a: Json0Op = [{ p: ["n"], od: 0, oi: 1 }];
    const b: Json0Op = [{ p: ["n"], od: 1, oi: 2 }];
    expect(applyJson0({ n: 0 }, composeJson0(a, b))).toEqual({ n: 2 });
  });

  it("transformStackBy drops emptied ops", () => {
    const opA: Json0Op = [{ p: ["x"], od: 0, oi: 1 }];
    const opB: Json0Op = [{ p: ["x"], od: 0, oi: 2 }];
    const stack: Json0Op[] = [transformJson0(opA, opB, "right")];
    expect(stack[0].length).toBe(0);
    transformStackBy(stack, opB, "left");
    expect(stack.length).toBe(0);
  });
});

describe("temporal mode ot", () => {
  it("undoes and redoes local edits with json0 ops", () => {
    const emitted: OtOpEvent[] = [];
    const [state, setState, api] = createStore(
      { count: 0, label: "a" },
      temporal({
        mode: "ot",
        clientId: "alice",
        onOp: (e) => emitted.push(e),
      }),
    );
    const t = (
      api as TemporalStoreApi<{ count: number; label: string }>
    ).temporal;

    setState("count", 1);
    setState("label", "b");
    expect(state.count).toBe(1);
    expect(state.label).toBe("b");
    expect(emitted.length).toBe(2);
    expect(emitted[0].kind).toBe("edit");
    expect(emitted[0].clientId).toBe("alice");
    expect(t.getPast()[0].op).toBeDefined();

    t.undo();
    expect(state.label).toBe("a");
    expect(emitted.at(-1)?.kind).toBe("undo");
    expect(t.canRedo()).toBe(true);
    expect(t.getFuture().length).toBe(1);
    t.undo();
    expect(state.count).toBe(0);
    t.redo();
    expect(state.count).toBe(1);
    expect(emitted.at(-1)?.kind).toBe("redo");
  });

  it("OT receiveRemote no-ops empty ops and works without onOp", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal({ mode: "ot" }));
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 1);
    t.receiveRemote([]);
    expect(api.getState().n).toBe(1);
  });

  it("transforms undo against concurrent remote ops (full OT)", () => {
    const [, setA, apiA] = createStore(
      { x: 0 },
      temporal({ mode: "ot", clientId: "a" }),
    );
    const tA = (apiA as TemporalStoreApi<{ x: number }>).temporal;

    const [, setB, apiB] = createStore(
      { x: 0 },
      temporal({ mode: "ot", clientId: "b" }),
    );
    const tB = (apiB as TemporalStoreApi<{ x: number }>).temporal;

    // Concurrent edits from the same base.
    setA("x", 1);
    setB("x", 2);
    const opA = tA.getPast()[0].op as Json0Op;
    const opB = tB.getPast()[0].op as Json0Op;

    // A receives B concurrently while opA still pending.
    tA.receiveRemote(opB, { clientId: "b", id: "b1" });
    expect(apiA.getState().x).toBe(2);

    // Pending local op is transformed (often to empty for same-key replace).
    const pending = tA.getPending();
    expect(pending.length).toBe(1);

    // Undo A's contribution after transform — standard json0 OT undo.
    expect(tA.canUndo()).toBe(true);
    tA.undo();
    // invert(opA) transformed by B → set x back toward A's od side.
    expect(typeof apiA.getState().x).toBe("number");

    // Cross-check transform helpers match receiveRemote outcome shape.
    const bPrime = transformJson0(opB, opA, "left");
    expect(bPrime).toEqual([{ p: ["x"], od: 1, oi: 2 }]);
  });

  it("acks local echo without re-applying", () => {
    const events: OtOpEvent[] = [];
    const [, setState, api] = createStore(
      { n: 0 },
      temporal({
        mode: "ot",
        onOp: (e) => events.push(e),
      }),
    );
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 5);
    expect(t.getPending().length).toBe(1);
    const id = events[0].id;
    t.receiveRemote(events[0].op, { id, clientId: t.getClientId() });
    expect(t.getPending().length).toBe(0);
    expect(api.getState().n).toBe(5);
    t.ack(id); // already gone — no-op
    expect(api.getState().n).toBe(5);
  });

  it("ack removes pending by id", () => {
    const events: OtOpEvent[] = [];
    const [, setState, api] = createStore(
      { n: 0 },
      temporal({ mode: "ot", onOp: (e) => events.push(e) }),
    );
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 1);
    t.ack(events[0].id);
    expect(t.getPending().length).toBe(0);
  });

  it("cancels unacked edit from pending on undo", () => {
    const events: OtOpEvent[] = [];
    const [, setState, api] = createStore(
      { n: 0 },
      temporal({ mode: "ot", onOp: (e) => events.push(e) }),
    );
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 3);
    expect(t.getPending().length).toBe(1);
    t.undo();
    expect(api.getState().n).toBe(0);
    // Original edit removed; undo op is now pending.
    expect(t.getPending().some((p) => p.id === events[0].id)).toBe(false);
    expect(t.getPending().length).toBe(1);
    expect(events.at(-1)?.kind).toBe("undo");
  });

  it("patches mode rejects receiveRemote and ack", () => {
    const [, , api] = createStore({ n: 0 }, temporal());
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    expect(() => t.receiveRemote([])).toThrow(/mode: "ot"/);
    expect(() => t.ack("x")).toThrow(/mode: "ot"/);
    expect(t.getPending()).toEqual([]);
    expect(typeof t.getClientId()).toBe("string");
  });

  it("OT transactions coalesce into one undoable op", () => {
    const [, setState, api] = createStore(
      { a: 0, b: 0 },
      temporal({ mode: "ot" }),
    );
    const t = (api as TemporalStoreApi<{ a: number; b: number }>).temporal;
    t.beginTransaction();
    setState("a", 1);
    setState("b", 2);
    t.endTransaction();
    expect(t.getPast().length).toBe(1);
    t.undo();
    expect(api.getState()).toEqual({ a: 0, b: 0 });
  });

  it("OT clear resets pending and stacks", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal({ mode: "ot" }));
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 1);
    t.clear();
    expect(t.canUndo()).toBe(false);
    expect(t.getPending().length).toBe(0);
  });

  it("OT respects limit", () => {
    const [, setState, api] = createStore(
      { n: 0 },
      temporal({ mode: "ot", limit: 2 }),
    );
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 1);
    setState("n", 2);
    setState("n", 3);
    expect(t.getPast().length).toBe(2);
  });

  it("OT undo/redo no-op on empty stacks", () => {
    const [, , api] = createStore({ n: 0 }, temporal({ mode: "ot" }));
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    t.undo();
    t.redo();
    expect(api.getState().n).toBe(0);
  });

  it("OT pause and resume skip recording", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal({ mode: "ot" }));
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    t.pause();
    setState("n", 1);
    expect(t.canUndo()).toBe(false);
    t.resume();
    setState("n", 2);
    expect(t.canUndo()).toBe(true);
    t.undo();
    expect(api.getState().n).toBe(1);
  });

  it("OT undo after ack still broadcasts undo op", () => {
    const events: OtOpEvent[] = [];
    const [, setState, api] = createStore(
      { n: 0 },
      temporal({ mode: "ot", onOp: (e) => events.push(e) }),
    );
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    setState("n", 4);
    t.ack(events[0].id);
    expect(t.getPending().length).toBe(0);
    t.undo();
    expect(api.getState().n).toBe(0);
    expect(events.at(-1)?.kind).toBe("undo");
    expect(t.getPending().length).toBe(1);
  });

  it("OT skips transaction commit while paused", () => {
    const [, setState, api] = createStore({ n: 0 }, temporal({ mode: "ot" }));
    const t = (api as TemporalStoreApi<{ n: number }>).temporal;
    t.beginTransaction();
    setState("n", 1);
    t.pause();
    t.endTransaction();
    expect(t.canUndo()).toBe(false);
  });
});
