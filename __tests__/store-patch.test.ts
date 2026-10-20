/**
 * Tests for store patch diff / apply.
 */

import { describe, expect, it } from "bun:test";
import { applyPatches, diff } from "../src/patch.ts";

describe("diff / applyPatches", () => {
  it("returns empty patches when values are equal", () => {
    expect(diff({ a: 1 }, { a: 1 })).toEqual({
      patches: [],
      inversePatches: [],
    });
  });

  it("replaces primitives at root", () => {
    const { patches, inversePatches } = diff(1, 2);
    expect(applyPatches(1, patches)).toBe(2);
    expect(applyPatches(2, inversePatches)).toBe(1);
  });

  it("adds and removes object keys", () => {
    const before = { a: 1 };
    const after = { a: 1, b: 2 };
    const { patches, inversePatches } = diff(before, after);
    expect(applyPatches(before, patches)).toEqual(after);
    expect(applyPatches(after, inversePatches)).toEqual(before);
  });

  it("replaces nested object fields", () => {
    const before = { user: { name: "Ada", age: 1 } };
    const after = { user: { name: "Ada", age: 2 } };
    const { patches, inversePatches } = diff(before, after);
    expect(patches).toEqual([
      { op: "replace", path: ["user", "age"], value: 2 },
    ]);
    expect(applyPatches(before, patches)).toEqual(after);
    expect(applyPatches(after, inversePatches)).toEqual(before);
  });

  it("removes nested keys", () => {
    const before = { user: { name: "Ada", age: 2 } };
    const after = { user: { name: "Ada" } };
    const { patches, inversePatches } = diff(before, after);
    expect(applyPatches(before, patches)).toEqual(after);
    expect(applyPatches(after, inversePatches)).toEqual(before);
  });

  it("grows and shrinks arrays positionally", () => {
    const before = { items: [1, 2] };
    const after = { items: [1, 2, 3] };
    const grow = diff(before, after);
    expect(applyPatches(before, grow.patches)).toEqual(after);
    expect(applyPatches(after, grow.inversePatches)).toEqual(before);

    const shrink = diff(after, before);
    expect(applyPatches(after, shrink.patches)).toEqual(before);
    expect(applyPatches(before, shrink.inversePatches)).toEqual(after);
  });

  it("replaces array element values", () => {
    const before = { items: [{ id: 1 }, { id: 2 }] };
    const after = { items: [{ id: 1 }, { id: 9 }] };
    const { patches, inversePatches } = diff(before, after);
    expect(applyPatches(before, patches)).toEqual(after);
    expect(applyPatches(after, inversePatches)).toEqual(before);
  });

  it("replaces when type changes at a node", () => {
    const before = { value: { x: 1 } };
    const after = { value: 5 };
    const { patches, inversePatches } = diff(before, after);
    expect(applyPatches(before, patches)).toEqual(after);
    expect(applyPatches(after, inversePatches)).toEqual(before);
  });

  it("applies multiple patches in order", () => {
    const start = { a: 0, b: 0 };
    const mid = applyPatches(start, [
      { op: "replace", path: ["a"], value: 1 },
      { op: "replace", path: ["b"], value: 2 },
    ]);
    expect(mid).toEqual({ a: 1, b: 2 });
  });

  it("round-trips a larger object edit", () => {
    const before = {
      title: "draft",
      tags: ["a"],
      meta: { open: true },
    };
    const after = {
      title: "done",
      tags: ["a", "b"],
      meta: { open: false },
    };
    const { patches, inversePatches } = diff(before, after);
    expect(applyPatches(before, patches)).toEqual(after);
    expect(applyPatches(after, inversePatches)).toEqual(before);
  });

  it("applies root remove and root replace", () => {
    expect(applyPatches({ a: 1 }, [{ op: "remove", path: [] }])).toBeUndefined();
    expect(
      applyPatches(0, [{ op: "replace", path: [], value: { ok: true } }]),
    ).toEqual({ ok: true });
  });

  it("supports array push via add at length and mid remove", () => {
    const grown = applyPatches(
      { items: [1, 2] },
      [{ op: "add", path: ["items", 2], value: 3 }],
    );
    expect(grown).toEqual({ items: [1, 2, 3] });

    const shrunk = applyPatches(
      { items: [1, 2, 3] },
      [{ op: "remove", path: ["items", 0] }],
    );
    expect(shrunk).toEqual({ items: [2, 3] });
  });

  it("walks non-plain objects and throws on invalid parents", () => {
    const nullProto = Object.create(null) as Record<string, number>;
    nullProto.a = 1;
    expect(
      applyPatches(nullProto, [{ op: "replace", path: ["a"], value: 2 }]),
    ).toEqual({ a: 2 });

    expect(() =>
      applyPatches(
        { a: 1 },
        [{ op: "replace", path: ["a", "nested"], value: 1 }],
      ),
    ).toThrow(/Cannot set key/);

    expect(() =>
      applyPatches(
        { a: 1 },
        [{ op: "replace", path: ["a", "b", "c"], value: 1 }],
      ),
    ).toThrow(/Cannot walk path/);

    expect(() =>
      applyPatches(1, [{ op: "add", path: ["x"], value: 1 }]),
    ).toThrow(/Cannot set key/);

    expect(() =>
      applyPatches(1, [{ op: "remove", path: ["x"] }]),
    ).toThrow(/Cannot remove key/);
  });

  it("walks arrays when applying nested patches", () => {
    const next = applyPatches(
      { items: [{ v: 1 }, { v: 2 }] },
      [{ op: "replace", path: ["items", 1, "v"], value: 9 }],
    );
    expect(next).toEqual({ items: [{ v: 1 }, { v: 9 }] });

    const replaced = applyPatches(
      { items: [1, 2, 3] },
      [{ op: "replace", path: ["items", 1], value: 99 }],
    );
    expect(replaced).toEqual({ items: [1, 99, 3] });

    const trimmed = applyPatches(
      { items: [1, 2, 3] },
      [{ op: "remove", path: ["items", 2] }],
    );
    expect(trimmed).toEqual({ items: [1, 2] });
  });
});
