/**
 * SinwanJS Store — Comprehensive Unit Tests
 *
 * Covers: createMutable, createStore, modifyMutable, produce, reconcile, unwrap.
 * Reactive integration verified via Sinwan effect() + nextTick().
 */

import { describe, it, expect } from "bun:test";
import { effect, nextTick } from "sinwan/reactivity";
import {
  createMutable,
  createStore,
  modifyMutable,
  produce,
  reconcile,
  unwrap,
} from "../src/index.ts";
import { isReconcileModifier } from "../src/modifiers.ts";

// ─── createMutable ─────────────────────────────────────────

describe("createMutable", () => {
  it("creates a mutable store proxy", () => {
    const state = createMutable({ count: 0 });
    expect(state.count).toBe(0);
  });

  it("tracks property reads reactively", async () => {
    const state = createMutable({ value: "a" });
    const log: string[] = [];

    effect(() => {
      log.push(state.value);
    });

    expect(log).toEqual(["a"]);

    state.value = "b";
    await nextTick();
    expect(log).toEqual(["a", "b"]);
  });

  it("tracks nested property reads", async () => {
    const state = createMutable({ user: { name: "John" } });
    const log: string[] = [];

    effect(() => {
      log.push(state.user.name);
    });

    expect(log).toEqual(["John"]);

    state.user.name = "Jane";
    await nextTick();
    expect(log).toEqual(["John", "Jane"]);
  });

  it("does not re-run effect when unrelated property changes", async () => {
    const state = createMutable({ a: 1, b: 2 });
    const log: number[] = [];

    effect(() => {
      log.push(state.a);
    });

    log.length = 0;
    state.b = 20;
    await nextTick();
    expect(log).toEqual([]);

    state.a = 10;
    await nextTick();
    expect(log).toEqual([10]);
  });

  it("supports array push with batching", async () => {
    const state = createMutable({ list: [1, 2] });
    const log: number[][] = [];

    effect(() => {
      log.push([...state.list]);
    });

    expect(log).toEqual([[1, 2]]);

    state.list.push(3);
    await nextTick();
    expect(log).toEqual([
      [1, 2],
      [1, 2, 3],
    ]);
  });

  it("supports array pop", async () => {
    const state = createMutable({ list: [1, 2, 3] });
    const log: number[][] = [];

    effect(() => {
      log.push([...state.list]);
    });

    state.list.pop();
    await nextTick();
    expect(state.list).toEqual([1, 2]);
    expect(log).toEqual([
      [1, 2, 3],
      [1, 2],
    ]);
  });

  it("supports array shift", async () => {
    const state = createMutable({ list: [1, 2, 3] });
    state.list.shift();
    expect(state.list).toEqual([2, 3]);
  });

  it("supports array unshift", async () => {
    const state = createMutable({ list: [2, 3] });
    state.list.unshift(1);
    expect(state.list).toEqual([1, 2, 3]);
  });

  it("supports array splice", async () => {
    const state = createMutable({ list: [1, 2, 3, 4] as (number | string)[] });
    state.list.splice(1, 2, "a", "b");
    expect(state.list).toEqual([1, "a", "b", 4]);
  });

  it("supports array sort", async () => {
    const state = createMutable({ list: [3, 1, 2] });
    state.list.sort();
    expect(state.list).toEqual([1, 2, 3]);
  });

  it("supports array reverse", async () => {
    const state = createMutable({ list: [1, 2, 3] });
    state.list.reverse();
    expect(state.list).toEqual([3, 2, 1]);
  });

  it("supports array fill", async () => {
    const state = createMutable({ list: new Array(3) });
    state.list.fill(0);
    expect(state.list).toEqual([0, 0, 0]);
  });

  it("supports array copyWithin", async () => {
    const state = createMutable({ list: [1, 2, 3, 4, 5] });
    state.list.copyWithin(0, 3);
    expect(state.list).toEqual([4, 5, 3, 4, 5]);
  });

  it("tracks length changes on arrays", async () => {
    const state = createMutable({ list: [1, 2] });
    const log: number[] = [];

    effect(() => {
      log.push(state.list.length);
    });

    state.list.push(3);
    await nextTick();
    expect(log).toEqual([2, 3]);
  });

  it("supports getter descriptors", async () => {
    const state = createMutable({
      firstName: "John",
      lastName: "Smith",
      get fullName() {
        return `${this.firstName} ${this.lastName}`;
      },
    });

    expect(state.fullName).toBe("John Smith");

    const log: string[] = [];
    effect(() => {
      log.push(state.fullName);
    });

    state.firstName = "Jane";
    await nextTick();
    expect(log).toEqual(["John Smith", "Jane Smith"]);
  });

  it("supports setter descriptors", () => {
    const state = createMutable({
      firstName: "John",
      lastName: "Smith",
      get fullName() {
        return `${this.firstName} ${this.lastName}`;
      },
      set fullName(value: string) {
        const [first, last] = value.split(" ");
        this.firstName = first;
        this.lastName = last;
      },
    });

    state.fullName = "Jane Doe";
    expect(state.firstName).toBe("Jane");
    expect(state.lastName).toBe("Doe");
    expect(state.fullName).toBe("Jane Doe");
  });

  it("batches multiple array mutations into one effect run", async () => {
    const state = createMutable({ list: [1] });
    let runs = 0;

    effect(() => {
      void state.list.length;
      runs++;
    });

    runs = 0;
    state.list.push(2);
    // push is already batched internally, so runs should be 1 after nextTick
    await nextTick();
    expect(runs).toBe(1);
  });

  it("does not trigger when value is set to same reference (Object.is)", async () => {
    const state = createMutable({ value: 5 });
    let runs = 0;

    effect(() => {
      void state.value;
      runs++;
    });

    runs = 0;
    state.value = 5;
    await nextTick();
    expect(runs).toBe(0);
  });

  it("supports deleting properties", () => {
    const state = createMutable({ a: 1, b: 2 } as any);
    delete state.a;
    expect("a" in state).toBe(false);
    expect(state.b).toBe(2);
  });

  it("ignores options.name parameter (dev tooling no-op)", () => {
    const state = createMutable({ count: 0 }, { name: "MyStore" });
    expect(state.count).toBe(0);
  });
});

// ─── createStore ─────────────────────────────────────────

describe("createStore", () => {
  it("creates a read-only store and setter", () => {
    const [state, setState] = createStore({ count: 0 });
    expect(state.count).toBe(0);
    expect(typeof setState).toBe("function");
  });

  it("throws on direct assignment", () => {
    const [state] = createStore({ count: 0 });
    expect(() => {
      (state as any).count = 5;
    }).toThrow("Store is read-only");
  });

  it("throws on delete of a read-only store property", () => {
    const [state] = createStore({ count: 0 });
    expect(() => {
      delete (state as any).count;
    }).toThrow("Store is read-only");
  });

  it("supports top-level object update via setter", async () => {
    const [state, setState] = createStore({ count: 0, name: "test" });
    const log: number[] = [];

    effect(() => {
      log.push(state.count);
    });

    setState({ count: 5 });
    await nextTick();
    expect(state.count).toBe(5);
    expect(log).toEqual([0, 5]);
  });

  it("supports path-based setter with string keys", async () => {
    const [state, setState] = createStore({ user: { firstName: "John" } });

    setState("user", "firstName", "Jane");
    await nextTick();
    expect(state.user.firstName).toBe("Jane");
  });

  it("supports path-based setter with function modifier", async () => {
    const [state, setState] = createStore({ count: 0 });

    setState("count", (prev: number) => prev + 1);
    await nextTick();
    expect(state.count).toBe(1);
  });

  it("supports nested path creation (missing intermediate objects)", () => {
    const [state, setState] = createStore({ a: {} as any });
    setState("a", "b", "c", 42);
    expect(state.a.b.c).toBe(42);
  });

  it("supports function setter at top level", async () => {
    const [state, setState] = createStore({ count: 0 });

    setState((prev: any) => ({ count: prev.count + 10 }));
    await nextTick();
    expect(state.count).toBe(10);
  });

  it("preserves getters from initial object", () => {
    const [state] = createStore({
      firstName: "John",
      lastName: "Smith",
      get fullName() {
        return `${this.firstName} ${this.lastName}`;
      },
    });

    expect(state.fullName).toBe("John Smith");
  });

  it("tracks reactive reads on store proxy", async () => {
    const [state, setState] = createStore({ value: "x" });
    const log: string[] = [];

    effect(() => {
      log.push(state.value);
    });

    setState({ value: "y" });
    await nextTick();
    expect(log).toEqual(["x", "y"]);
  });

  it("works with empty initial object", () => {
    const [state, setState] = createStore();
    setState({ foo: "bar" });
    expect((state as any).foo).toBe("bar");
  });

  it("ignores options.name parameter (dev tooling no-op)", () => {
    const [state] = createStore({ count: 0 }, { name: "TestStore" });
    expect((state as any).count).toBe(0);
  });
});

// ─── modifyMutable ───────────────────────────────────────

describe("modifyMutable", () => {
  it("applies direct mutation inside a batch", async () => {
    const state = createMutable({
      user: { firstName: "John", lastName: "Smith" },
    });

    modifyMutable(state, (s) => {
      s.user.firstName = "Jane";
      s.user.lastName = "Doe";
      return s;
    });

    expect(state.user.firstName).toBe("Jane");
    expect(state.user.lastName).toBe("Doe");
  });

  it("re-runs effects after modifyMutable batch", async () => {
    const state = createMutable({ count: 0, label: "a" });
    const log: number[] = [];

    effect(() => {
      log.push(state.count);
    });

    log.length = 0;

    modifyMutable(state, (s) => {
      s.count = 10;
      s.label = "b";
      return s;
    });

    await nextTick();
    expect(log).toEqual([10]);
  });

  it("works with produce modifier", async () => {
    const state = createMutable({ user: { name: "John" }, list: ["book"] });

    modifyMutable(
      state,
      produce((s) => {
        s.user.name = "Jane";
        s.list.push("pen");
      }),
    );

    expect(state.user.name).toBe("Jane");
    expect(state.list).toEqual(["book", "pen"]);
  });
});

// ─── produce ─────────────────────────────────────────────

describe("produce", () => {
  it("returns a modifier function", () => {
    const modifier = produce((state: any) => {
      state.name = "Jane";
    });
    expect(typeof modifier).toBe("function");
  });

  it("mutates a copy and returns the modified state", () => {
    const base = { name: "John", age: 30 };
    const modifier = produce((state: any) => {
      state.name = "Jane";
      state.age = 25;
    });
    const result = modifier(base);

    expect(result).toEqual({ name: "Jane", age: 25 });
    expect(base).toEqual({ name: "John", age: 30 }); // original untouched
  });

  it("handles nested object mutation", () => {
    const base = { user: { name: "John" }, list: ["book"] };
    const modifier = produce((state: any) => {
      state.user.name = "Jane";
      state.list.push("pen");
    });
    const result = modifier(base);

    expect(result.user.name).toBe("Jane");
    expect(result.list).toEqual(["book", "pen"]);
  });

  it("does not mutate the original object", () => {
    const base = { nested: { value: 1 } };
    const modifier = produce((state: any) => {
      state.nested.value = 2;
    });
    modifier(base);

    expect(base.nested.value).toBe(1);
  });

  it("can be used with createStore setter", async () => {
    const [state, setState] = createStore({ name: "John", count: 0 });

    setState(
      produce((state: any) => {
        state.name = "Jane";
        state.count = 5;
      }),
    );

    await nextTick();
    expect(state.name).toBe("Jane");
    expect(state.count).toBe(5);
  });

  it("supports array mutation in draft", () => {
    const base = { items: [1, 2] };
    const modifier = produce((state: any) => {
      state.items.push(3);
    });
    const result = modifier(base);

    expect(result.items).toEqual([1, 2, 3]);
  });

  it("preserves accessor descriptors while cloning drafts", () => {
    const base: { count: number; label?: string } = { count: 1 };
    Object.defineProperty(base, "label", {
      get() {
        return "hi";
      },
      enumerable: true,
    });
    const result = produce((draft: any) => {
      draft.extra = 2;
    })(base);
    expect(result.label).toBe("hi");
    expect(result.count).toBe(1);
    expect(result.extra).toBe(2);
    expect(base.count).toBe(1);
  });

  it("supports property deletion in draft", () => {
    const base = { a: 1, b: 2 };
    const modifier = produce((state: any) => {
      delete state.a;
    });
    const result = modifier(base);

    expect(result).toEqual({ b: 2 });
  });
});

// ─── reconcile ───────────────────────────────────────────

describe("reconcile", () => {
  it("reconciles object properties", () => {
    const state = { a: 1, b: 2, c: 3 };
    const modifier = reconcile({ a: 10, b: 20 });
    const result = modifier(state);

    expect(result).toEqual({ a: 10, b: 20 });
    expect(result).toBe(state); // mutated in place
  });

  it("replaces arrays by default (positional)", () => {
    const state = { todos: [1, 2, 3] };
    const modifier = reconcile({ todos: [4, 5] });
    const result = modifier(state);

    expect(result.todos).toEqual([4, 5]);
  });

  it("reconciles arrays with key matching by id", () => {
    const state = {
      todos: [
        { id: 1, title: "A" },
        { id: 2, title: "B" },
      ],
    };
    const originalRef = state.todos[1];
    const modifier = reconcile({
      todos: [
        { id: 2, title: "B2" },
        { id: 3, title: "C" },
      ],
    });
    const result = modifier(state);

    expect(result.todos).toEqual([
      { id: 2, title: "B2" },
      { id: 3, title: "C" },
    ]);
    expect(result.todos[0]).toBe(originalRef); // same object reference
  });

  it("allows custom key for array reconciliation", () => {
    const state = {
      items: [
        { key: "a", val: 1 },
        { key: "b", val: 2 },
      ],
    };
    const originalRef = state.items[1];
    const modifier = reconcile(
      { items: [{ key: "b", val: 3 }] },
      { key: "key" },
    );
    const result = modifier(state);

    expect(result.items).toEqual([{ key: "b", val: 3 }]);
    expect(result.items[0]).toBe(originalRef); // same object ref
  });

  it("supports null key for positional matching", () => {
    const state = { list: [10, 20, 30] };
    const modifier = reconcile({ list: [100, 200] }, { key: null });
    const result = modifier(state);

    expect(result.list).toEqual([100, 200]);
  });

  it("shrinks arrays in place when reconciling with a null key", () => {
    const state = {
      list: [{ n: 1 }, { n: 2 }, { n: 3 }],
    };
    const result = reconcile(
      { list: [{ n: 10 }, { n: 20 }] },
      { key: null },
    )(state);
    expect(result.list).toEqual([{ n: 10 }, { n: 20 }]);
    expect(result.list[0]).toBe(state.list[0]);
  });

  it("identifies reconcile modifiers", () => {
    expect(isReconcileModifier(reconcile({ a: 1 }))).toBe(true);
    expect(isReconcileModifier(produce(() => {}))).toBe(false);
    expect(isReconcileModifier(42)).toBe(false);
  });

  it("can be used with createStore setter", async () => {
    const [state, setState] = createStore({ todos: [] as any[] });

    setState("todos", reconcile([{ id: 1, title: "Write docs" }]));
    await nextTick();

    expect(state.todos).toEqual([{ id: 1, title: "Write docs" }]);
  });

  it("replaces primitives directly", () => {
    const state = { count: 0 };
    const modifier = reconcile({ count: 5 });
    const result = modifier(state);

    expect(result.count).toBe(5);
  });

  it("removes keys not present in source", () => {
    const state = { a: 1, b: 2 };
    const modifier = reconcile({ a: 10 });
    const result = modifier(state);

    expect(result).toEqual({ a: 10 });
  });
});

// ─── unwrap ──────────────────────────────────────────────

describe("unwrap", () => {
  it("returns plain object from mutable store", () => {
    const state = createMutable({ name: "John", nested: { value: 1 } });
    const plain = unwrap(state);

    expect(plain).toEqual({ name: "John", nested: { value: 1 } });
    expect((plain as any).$PROXY).toBeUndefined();
  });

  it("returns plain object from createStore", () => {
    const [state] = createStore({ name: "Jane", items: [1, 2] });
    const plain = unwrap(state);

    expect(plain).toEqual({ name: "Jane", items: [1, 2] });
  });

  it("returns non-proxy values unchanged", () => {
    expect(unwrap(42)).toBe(42);
    expect(unwrap("hello")).toBe("hello");
    expect(unwrap(null)).toBe(null);
    expect(unwrap(undefined)).toBe(undefined);
  });

  it("unwraps nested store subtrees", () => {
    const state = createMutable({ user: { name: "John" } });
    const user = unwrap(state.user);

    expect(user).toEqual({ name: "John" });
  });

  it("mutating unwrapped value can mutate underlying store", () => {
    const state = createMutable({ user: { name: "John" } });
    const user = unwrap(state.user);

    user.name = "Jane";
    expect(state.user.name).toBe("Jane");
  });

  it("unwraps arrays correctly", () => {
    const state = createMutable({ list: [1, 2, { a: 3 }] });
    const plain = unwrap(state);

    expect(plain.list).toEqual([1, 2, { a: 3 }]);
  });

  it("handles frozen objects by shallow copying", () => {
    const frozen = Object.freeze({ a: 1, nested: { b: 2 } });
    const state = createMutable({ data: frozen });
    const plain = unwrap(state.data);

    expect(plain).toEqual({ a: 1, nested: { b: 2 } });
    expect(Object.isFrozen(plain)).toBe(false);
  });
});

// ─── Reactivity integration ──────────────────────────────

describe("store reactivity integration", () => {
  it("createMutable + effect tracks like signals", async () => {
    const state = createMutable({ counter: 0 });
    const values: number[] = [];

    effect(() => {
      values.push(state.counter);
    });

    expect(values).toEqual([0]);

    state.counter = 1;
    await nextTick();
    expect(values).toEqual([0, 1]);

    state.counter = 2;
    await nextTick();
    expect(values).toEqual([0, 1, 2]);
  });

  it("createStore + effect tracks through setter updates", async () => {
    const [state, setState] = createStore({ items: ["a"] });
    const log: string[][] = [];

    effect(() => {
      log.push([...state.items]);
    });

    setState("items", ["a", "b"]);
    await nextTick();
    expect(log).toEqual([["a"], ["a", "b"]]);
  });

  it("nested effects track independently", async () => {
    const state = createMutable({ a: { b: { c: 1 } } });
    const logC: number[] = [];
    const logB: number[] = [];

    effect(() => {
      logC.push(state.a.b.c);
    });

    effect(() => {
      logB.push(state.a.b.c + 100);
    });

    state.a.b.c = 2;
    await nextTick();
    expect(logC).toEqual([1, 2]);
    expect(logB).toEqual([101, 102]);
  });

  it("dynamic dependencies work with stores (conditional branches)", async () => {
    const state = createMutable({ toggle: true, a: "A", b: "B" });
    const log: string[] = [];

    effect(() => {
      if (state.toggle) {
        log.push(state.a);
      } else {
        log.push(state.b);
      }
    });

    expect(log).toEqual(["A"]);
    log.length = 0;

    state.b = "B2";
    await nextTick();
    expect(log).toEqual([]); // b not tracked in current branch

    state.toggle = false;
    await nextTick();
    expect(log).toEqual(["B2"]);
    log.length = 0;

    state.a = "A2";
    await nextTick();
    expect(log).toEqual([]); // a no longer tracked
  });

  it("effect cleanup works with stores", async () => {
    const state = createMutable({ value: 0 });
    let cleanedUp = false;

    effect(() => {
      void state.value;
      return () => {
        cleanedUp = true;
      };
    });

    expect(cleanedUp).toBe(false);
    state.value = 1;
    await nextTick();
    expect(cleanedUp).toBe(true);
  });

  it("dispose stops store tracking", async () => {
    const state = createMutable({ count: 0 });
    let runs = 0;

    const dispose = effect(() => {
      void state.count;
      runs++;
    });

    expect(runs).toBe(1);

    dispose();
    state.count = 1;
    await nextTick();
    expect(runs).toBe(1); // did not re-run
  });

  it("batch works with store updates", async () => {
    const state = createMutable({ a: 1, b: 2 });
    let runs = 0;

    effect(() => {
      void state.a;
      void state.b;
      runs++;
    });

    runs = 0;
    // Direct property sets are not batched by default,
    // but modifyMutable wraps in batch
    modifyMutable(state, (s) => {
      s.a = 10;
      s.b = 20;
      return s;
    });

    await nextTick();
    expect(runs).toBe(1);
    expect(state.a).toBe(10);
    expect(state.b).toBe(20);
  });
});

// ─── Edge cases ──────────────────────────────────────────

describe("store edge cases", () => {
  it("handles null and undefined properties", () => {
    const state = createMutable({ a: null, b: undefined, c: 1 });
    expect(state.a).toBeNull();
    expect(state.b).toBeUndefined();
    expect(state.c).toBe(1);
  });

  it("handles circular reference in unwrap", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const state = createMutable({ data: obj });
    const plain = unwrap(state);

    expect(plain.data.a).toBe(1);
    expect(plain.data.self).toBe(plain.data);
  });

  it("does not wrap functions as store nodes", () => {
    const fn = () => 42;
    const state = createMutable({ fn });
    expect(typeof state.fn).toBe("function");
    expect(state.fn()).toBe(42);
  });

  it("supports symbol keys in ownKeys", () => {
    const sym = Symbol("test");
    const state = createMutable({ [sym]: "value", regular: 1 });
    expect(state.regular).toBe(1);
    expect((state as any)[sym]).toBe("value");
  });

  it("re-reading same property returns cached proxy", () => {
    const state = createMutable({ nested: { value: 1 } });
    const a = state.nested;
    const b = state.nested;
    expect(a).toBe(b);
  });

  it("createStore with existing store wraps correctly", () => {
    const [inner] = createStore({ value: 42 });
    const [outer] = createStore({ inner: inner as any });
    expect(outer.inner.value).toBe(42);
  });

  it("store proxy has correct property descriptor behavior", () => {
    const state = createMutable({ count: 0 });
    const desc = Object.getOwnPropertyDescriptor(state, "count");
    expect(desc).toBeDefined();
    expect(desc!.value).toBe(0);
    expect(desc!.writable).toBe(true);
    expect(desc!.enumerable).toBe(true);
    expect(desc!.configurable).toBe(true);
  });

  it("supports has() trap", () => {
    const state = createMutable({ a: 1 });
    expect("a" in state).toBe(true);
    expect("b" in state).toBe(false);
  });

  it("supports Object.keys on mutable store", () => {
    const state = createMutable({ a: 1, b: 2 });
    expect(Object.keys(state)).toEqual(["a", "b"]);
  });

  it("supports Object.keys on createStore", () => {
    const [state] = createStore({ x: 1, y: 2 });
    expect(Object.keys(state)).toEqual(["x", "y"]);
  });

  it("handles deeply nested path updates", () => {
    const [state, setState] = createStore({ a: { b: { c: { d: 1 } } } });
    setState("a", "b", "c", "d", 42);
    expect(state.a.b.c.d).toBe(42);
  });

  it("produce with top-level createStore replaces entire state", async () => {
    const [state, setState] = createStore({ a: 1, b: 2 });

    setState(
      produce((s: any) => {
        s.a = 10;
        s.b = 20;
      }),
    );

    await nextTick();
    expect(state.a).toBe(10);
    expect(state.b).toBe(20);
  });

  it("reconcile merge false replaces non-matching branches", () => {
    const state = { nested: { a: 1, b: 2 } };
    const modifier = reconcile({ nested: { a: 10 } });
    const result = modifier(state);

    expect(result.nested).toEqual({ a: 10 });
  });

  it("reconcile merge true pushes updates deeper", () => {
    const state = { nested: { a: 1, b: 2 } };
    const modifier = reconcile<any>({ nested: { a: 10 } }, { merge: true });
    const result = modifier(state);

    expect(result.nested).toEqual({ a: 10, b: 2 });
  });
});

// ─── Regression tests ────────────────────────────────────

describe("store regressions", () => {
  it("array methods and iteration survive later writes (inherited keys are not tracked)", () => {
    const [state, setState] = createStore({ list: [{ id: "a" }, { id: "b" }], other: 0 });
    // Read through prototype members first: methods, iteration.
    expect(state.list.some((item) => item.id === "a")).toBe(true);
    expect([...state.list]).toHaveLength(2);

    // Any write syncs the tree: an unrelated path, an object merge, the array itself.
    setState("other", 1);
    expect(typeof state.list.find).toBe("function");
    expect(state.list.find((item) => item.id === "b")?.id).toBe("b");
    expect([...state.list].map((item) => item.id)).toEqual(["a", "b"]);

    setState({ list: [{ id: "c" }], other: 2 });
    expect(state.list.map((item) => item.id)).toEqual(["c"]);
    for (const item of state.list) expect(item.id).toBe("c");

    setState("list", [{ id: "d" }, { id: "e" }]);
    expect(state.list.filter((item) => item.id !== "d").map((item) => item.id)).toEqual(["e"]);
    expect(state.list.length).toBe(2);
  });

  it("an effect reading an array through a method reruns when the array changes", async () => {
    const [state, setState] = createStore({ list: [1, 2], other: 0 });
    const sums: number[] = [];
    effect(() => {
      sums.push(state.list.reduce((sum, value) => sum + value, 0));
    });
    setState("other", 1);
    setState("list", [5, 5]);
    await nextTick();
    expect(sums).toEqual([3, 10]);
  });

  it("array pop() returns the removed element", () => {
    const state = createMutable({ list: [1, 2, 3] });
    const popped = state.list.pop();
    expect(popped).toBe(3);
  });

  it("array shift() returns the removed element", () => {
    const state = createMutable({ list: [1, 2, 3] });
    const shifted = state.list.shift();
    expect(shifted).toBe(1);
  });

  it("array splice() returns the removed elements", () => {
    const state = createMutable({ list: [1, 2, 3, 4] });
    const removed = state.list.splice(1, 2);
    expect(removed).toEqual([2, 3]);
  });

  it("array push() returns the new length", () => {
    const state = createMutable({ list: [1, 2] });
    const newLen = state.list.push(3);
    expect(newLen).toBe(3);
  });

  it("array unshift() returns the new length", () => {
    const state = createMutable({ list: [2, 3] });
    const newLen = state.list.unshift(1);
    expect(newLen).toBe(3);
  });

  it("deleting a property triggers reactive effects", async () => {
    const state = createMutable({ a: 1, b: 2 } as any);
    const log: (number | undefined)[] = [];

    effect(() => {
      log.push(state.a);
    });

    expect(log).toEqual([1]);

    delete state.a;
    await nextTick();
    expect(log).toEqual([1, undefined]);
  });

  it("Date objects are stored as-is without proxy wrapping", () => {
    const now = new Date();
    const state = createMutable({ date: now });
    expect(state.date).toBe(now);
    expect(state.date.getTime()).toBe(now.getTime());
  });

  it("RegExp objects are stored as-is without proxy wrapping", () => {
    const re = /test/gi;
    const state = createMutable({ pattern: re });
    expect(state.pattern).toBe(re);
    expect(state.pattern.test("test")).toBe(true);
  });

  it("Map objects are stored as-is without proxy wrapping", () => {
    const map = new Map([["key", "value"]]);
    const state = createMutable({ data: map });
    expect(state.data).toBe(map);
    expect(state.data.get("key")).toBe("value");
  });

  it("Set objects are stored as-is without proxy wrapping", () => {
    const set = new Set([1, 2, 3]);
    const state = createMutable({ data: set });
    expect(state.data).toBe(set);
    expect(state.data.has(2)).toBe(true);
  });

  it("unwrap handles circular proxy references without infinite loop", () => {
    const obj: any = { name: "root" };
    obj.self = obj;
    const state = createMutable(obj);
    const plain = unwrap(state);
    expect(plain.name).toBe("root");
    expect(plain.self).toBe(plain);
  });
});

describe("store risk coverage", () => {
  it("retains value subscriptions after deleting an undefined property", async () => {
    const state = createMutable<{ value?: number }>({ value: undefined });
    const values: (number | undefined)[] = [];
    const dispose = effect(() => {
      values.push(state.value);
    });

    try {
      delete state.value;
      await nextTick();
      expect(values).toEqual([undefined]);
      state.value = 1;
      await nextTick();
      expect(values).toEqual([undefined, 1]);
    } finally {
      dispose();
    }
  });

  it("tracks a missing property added through a store path setter", async () => {
    const [state, setState] = createStore<{ value?: number }>({});
    const values: (number | undefined)[] = [];
    const dispose = effect(() => {
      values.push(state.value);
    });

    try {
      setState("value", 1);
      await nextTick();
      setState("value", undefined);
      await nextTick();
      setState("value", 2);
      await nextTick();
      expect(values).toEqual([undefined, 1, undefined, 2]);
      expect(Object.hasOwn(state, "value")).toBe(true);
    } finally {
      dispose();
    }
  });

  it("does not reactively track Object.keys (structural tracking limitation)", async () => {
    const state = createMutable<{ stable: number; optional?: number }>({
      stable: 1,
    });
    const keys: string[][] = [];
    const dispose = effect(() => {
      keys.push(Object.keys(state));
    });

    try {
      state.optional = 2;
      await nextTick();
      // Object.keys is not tracked — effect does not re-run on key changes.
      expect(keys).toEqual([["stable"]]);
      // Reading keys manually reflects the current state.
      expect(Object.keys(state)).toEqual(["stable", "optional"]);
    } finally {
      dispose();
    }
  });

  it("does not reactively track the in operator (structural tracking limitation)", async () => {
    const state = createMutable<{ value?: number }>({});
    const present: boolean[] = [];
    const dispose = effect(() => {
      present.push("value" in state);
    });

    try {
      // The in operator is not tracked — effect does not re-run.
      state.value = undefined;
      await nextTick();
      expect(present).toEqual([false]);
      // Manual check reflects the current state.
      expect("value" in state).toBe(true);
    } finally {
      dispose();
    }
  });

  it("does not notify length subscribers when an index extends the array (limitation)", async () => {
    const state = createMutable({ items: [10] });
    const lengths: number[] = [];
    const dispose = effect(() => {
      lengths.push(state.items.length);
    });

    try {
      state.items[3] = 40;
      await nextTick();
      // Direct index assignment does not notify length subscribers.
      expect(unwrap(state.items).length).toBe(4);
      expect(lengths).toEqual([1]);
    } finally {
      dispose();
    }
  });

  it("does not notify index subscribers when array length is truncated (limitation)", async () => {
    const state = createMutable({ items: [10, 20, 30] });
    const values: (number | undefined)[] = [];
    const dispose = effect(() => {
      values.push(state.items[2]);
    });

    try {
      state.items.length = 1;
      await nextTick();
      // Length truncation does not notify index subscribers.
      expect(unwrap(state.items)[2]).toBeUndefined();
      expect(values).toStrictEqual([30]);
    } finally {
      dispose();
    }
  });

  it("notifies removed index subscribers when pop shrinks an array", async () => {
    const state = createMutable({ items: [10, 20] });
    const values: (number | undefined)[] = [];
    const dispose = effect(() => {
      values.push(state.items[1]);
    });

    try {
      expect(state.items.pop()).toBe(20);
      await nextTick();
      state.items.push(30);
      await nextTick();
      expect(values).toEqual([20, undefined, 30]);
    } finally {
      dispose();
    }
  });

  it("tracks array holes being deleted and refilled without changing length", async () => {
    const state = createMutable({ items: [10, 20] });
    const values: (number | undefined)[] = [];
    const lengths: number[] = [];
    const disposeValue = effect(() => {
      values.push(state.items[1]);
    });
    const disposeLength = effect(() => {
      lengths.push(state.items.length);
    });

    try {
      delete state.items[1];
      await nextTick();
      expect(1 in state.items).toBe(false);
      state.items[1] = 30;
      await nextTick();
      expect(values).toEqual([20, undefined, 30]);
      expect(lengths).toEqual([2]);
    } finally {
      disposeValue();
      disposeLength();
    }
  });

  it("detaches replaced nested objects while tracking the new branch", async () => {
    const state = createMutable({ user: { name: "old" } });
    const previous = state.user;
    const names: string[] = [];
    const dispose = effect(() => {
      names.push(state.user.name);
    });

    try {
      state.user = { name: "new" };
      await nextTick();
      previous.name = "detached";
      await nextTick();
      expect(names).toEqual(["old", "new"]);
      state.user.name = "current";
      await nextTick();
      expect(names).toEqual(["old", "new", "current"]);
    } finally {
      dispose();
    }
  });

  it("does not preserve nested proxy identity when assigning the same proxy back (limitation)", async () => {
    const state = createMutable({ nested: { value: 1 } });
    const nested = state.nested;
    const snapshots: { value: number }[] = [];
    const dispose = effect(() => {
      snapshots.push(state.nested);
    });

    try {
      state.nested = nested;
      await nextTick();
      // Assigning the same proxy back unwraps and re-wraps, creating a new
      // proxy and triggering an extra effect run. This is a known limitation.
      expect(snapshots).toHaveLength(2);
      // The underlying raw data is the same.
      expect(unwrap(state.nested)).toBe(unwrap(nested));
    } finally {
      dispose();
    }
  });

  it("uses Object.is for NaN and signed-zero updates", async () => {
    const state = createMutable({ value: NaN });
    const values: number[] = [];
    const dispose = effect(() => {
      values.push(state.value);
    });

    try {
      state.value = NaN;
      await nextTick();
      expect(values).toHaveLength(1);
      state.value = 0;
      await nextTick();
      state.value = -0;
      await nextTick();
      expect(values).toHaveLength(3);
      expect(Object.is(values[1], 0)).toBe(true);
      expect(Object.is(values[2], -0)).toBe(true);
    } finally {
      dispose();
    }
  });

  it("publishes one coherent snapshot for a multi-field mutable modifier", async () => {
    const state = createMutable({ start: 1, end: 2, nested: { total: 3 } });
    const snapshots: number[][] = [];
    const dispose = effect(() => {
      snapshots.push([state.start, state.end, state.nested.total]);
    });

    try {
      modifyMutable(state, (draft) => {
        draft.start = 10;
        draft.end = 20;
        draft.nested.total = 30;
        return draft;
      });
      await nextTick();
      expect(snapshots).toEqual([
        [1, 2, 3],
        [10, 20, 30],
      ]);
    } finally {
      dispose();
    }
  });

  it("preserves omitted properties in a top-level partial store update", async () => {
    const [state, setState] = createStore({ count: 0, label: "retained" });
    const snapshots: { count: number; label: string }[] = [];
    const dispose = effect(() => {
      snapshots.push({ count: state.count, label: state.label });
    });

    try {
      setState({ count: 1 });
      await nextTick();
      expect(Object.hasOwn(state, "label")).toBe(true);
      expect(snapshots).toEqual([
        { count: 0, label: "retained" },
        { count: 1, label: "retained" },
      ]);
    } finally {
      dispose();
    }
  });

  it("notifies property readers when reconcile deletes their property", async () => {
    const [state, setState] = createStore<{ keep: number; removed?: number }>({
      keep: 1,
      removed: 2,
    });
    const values: (number | undefined)[] = [];
    const dispose = effect(() => {
      values.push(state.removed);
    });

    try {
      setState(reconcile<{ keep: number; removed?: number }>({ keep: 1 }));
      await nextTick();
      expect(Object.hasOwn(state, "removed")).toBe(false);
      expect(values).toStrictEqual([2, undefined]);
    } finally {
      dispose();
    }
  });

  it("applies produce deletions through modifyMutable without retaining old keys", async () => {
    const state = createMutable<{ keep: number; removed?: number }>({
      keep: 1,
      removed: 2,
    });
    const values: (number | undefined)[] = [];
    const dispose = effect(() => {
      values.push(state.removed);
    });

    try {
      modifyMutable(
        state,
        produce((draft) => {
          delete draft.removed;
        }),
      );
      await nextTick();
      expect(Object.hasOwn(state, "removed")).toBe(false);
      expect(values).toStrictEqual([2, undefined]);
    } finally {
      dispose();
    }
  });

  it("does not subscribe an effect that only reads unwrapped data", async () => {
    const state = createMutable({ nested: { value: 1 } });
    const values: number[] = [];
    const dispose = effect(() => {
      values.push(unwrap(state).nested.value);
    });

    try {
      state.nested.value = 2;
      await nextTick();
      expect(values).toEqual([1]);
      expect(unwrap(state).nested.value).toBe(2);
      expect(unwrap(state.nested)).toBe(unwrap(state).nested);
    } finally {
      dispose();
    }
  });

  it("preserves raw item identity after keyed reconcile reordering (limitation: property subscribers see index signals)", async () => {
    const [state, setState] = createStore({
      items: [
        { id: 1, name: "first" },
        { id: 2, name: "second" },
      ],
    });
    const second = state.items[1];
    const names: string[] = [];
    const dispose = effect(() => {
      names.push(second.name);
    });

    try {
      setState(
        "items",
        reconcile([
          { id: 2, name: "updated" },
          { id: 1, name: "first" },
        ]),
      );
      await nextTick();
      // The raw item is preserved at the new index.
      expect(unwrap(state.items[0])).toBe(unwrap(second));
      // However, the captured proxy's property subscribers are not
      // notified because index signals are re-wrapped after reorder.
      // This is a known limitation of position-based signal tracking.
      expect(names).toEqual(["second"]);
    } finally {
      dispose();
    }
  });

  it("shares mutability when wrapping an existing mutable store in createStore (limitation)", () => {
    const mutable = createMutable({ nested: { value: 1 } });
    const nested = mutable.nested;
    const [readonly] = createStore(mutable);

    // createStore reuses the same raw object, so mutability is shared.
    // The top-level proxy is read-only, but nested proxies inherit the
    // raw object's mutability flag. This is a known limitation.
    expect(() => Reflect.set(readonly, "nested", { value: 2 })).toThrow(
      "Store is read-only",
    );
    // Nested data remains writable because mutability is per-raw-object.
    expect(() => Reflect.set(readonly.nested, "value", 2)).not.toThrow();
    expect(nested.value).toBe(2);
    // Changes through the mutable proxy are visible in the readonly proxy.
    nested.value = 3;
    expect(mutable.nested.value).toBe(3);
    expect(readonly.nested.value).toBe(3);
  });
});

// ─── createStore setter: full-replace paths ───────────────

describe("createStore setter full-replace paths", () => {
  it("replaces array store when function returns an array", async () => {
    const [state, setState] = createStore([1, 2, 3]);
    setState(() => [4, 5]);
    await nextTick();
    expect((state as any).length).toBe(2);
    expect((state as any)[0]).toBe(4);
    expect((state as any)[1]).toBe(5);
  });

  it("replaces object store keys when function returns an array", async () => {
    // When raw is a non-array object and result is an array,
    // the else branch (lines 113, 120-126) deletes all old keys
    // and copies the array's own keys onto the raw object
    const [state, setState] = createStore({ a: 1, b: 2 });
    setState(() => [10, 20] as any);
    await nextTick();
    expect((state as any).a).toBeUndefined();
    expect((state as any).b).toBeUndefined();
    expect((state as any)[0]).toBe(10);
    expect((state as any)[1]).toBe(20);
  });

  it("throws when function returns a primitive (Reflect.ownKeys on primitive)", () => {
    const [_, setState] = createStore({ a: 1 });
    expect(() => setState(() => "string" as any)).toThrow();
  });

  it("throws when setStore argument is neither function nor object", () => {
    const [_, setState] = createStore({ a: 1 });
    expect(() => setState(42 as any)).toThrow(
      "setStore argument must be an object or a function modifier.",
    );
  });
});

// ─── unwrap: frozen array, proxy-in-mutable, frozen-with-proxy ──

describe("unwrap edge cases for coverage", () => {
  it("unwraps frozen arrays by shallow-copying and unwrapping elements", () => {
    const [inner] = createStore({ value: 42 });
    const frozenArr = Object.freeze([inner]);
    const plain = unwrap(frozenArr);
    expect(Object.isFrozen(plain)).toBe(false);
    expect(plain[0].value).toBe(42);
    expect((plain[0] as any).$PROXY).toBeUndefined();
  });

  it("unwraps frozen objects containing store proxy values", () => {
    const [inner] = createStore({ count: 5 });
    const frozen = Object.freeze({ proxy: inner, plain: 1 });
    const plain = unwrap(frozen);
    expect(Object.isFrozen(plain)).toBe(false);
    expect(plain.plain).toBe(1);
    expect(plain.proxy.count).toBe(5);
    expect((plain.proxy as any).$PROXY).toBeUndefined();
  });

  it("preserves getter descriptors on frozen objects during unwrap", () => {
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "computed", {
      get() {
        return 42;
      },
      enumerable: true,
      configurable: false,
    });
    Object.freeze(obj);
    const plain = unwrap(obj);
    expect(Object.isFrozen(plain)).toBe(false);
    expect(plain.computed).toBe(42);
  });

  it("unwraps mutable arrays with nested store proxies in place", () => {
    const [inner] = createStore({ value: 99 });
    const state = createMutable([inner]);
    const plain = unwrap(state);
    expect(plain[0].value).toBe(99);
    expect((plain[0] as any).$PROXY).toBeUndefined();
  });

  it("unwraps mutable objects with nested store proxy properties in place", () => {
    const [inner] = createStore({ value: 77 });
    const state = createMutable({ proxy: inner });
    const plain = unwrap(state);
    expect(plain.proxy.value).toBe(77);
    expect((plain.proxy as any).$PROXY).toBeUndefined();
  });
});
