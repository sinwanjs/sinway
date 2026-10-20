/**
 * Sinway — JSON0 Operational Transform helpers
 *
 * Thin typed wrappers around `ot-json0` plus before/after → json0 diff.
 * Used by temporal `mode: "ot"` for collaborative undo/redo.
 */

import otJson0 from "ot-json0";

export type OtSide = "left" | "right";

export type Json0Component = {
  p: (string | number)[];
  oi?: unknown;
  od?: unknown;
  li?: unknown;
  ld?: unknown;
  lm?: number;
  na?: number;
  si?: string;
  sd?: string;
  t?: string;
  o?: unknown;
};

export type Json0Op = Json0Component[];

export type Json0Type = {
  name: string;
  create: (data?: unknown) => unknown;
  apply: (snapshot: unknown, op: Json0Op) => unknown;
  invert: (op: Json0Op) => Json0Op;
  transform: (op: Json0Op, otherOp: Json0Op, side: OtSide) => Json0Op;
  compose: (op1: Json0Op, op2: Json0Op) => Json0Op;
};

type OtJson0Module = {
  type: Json0Type;
};

const json0: Json0Type = (otJson0 as OtJson0Module).type;

export function getJson0Type(): Json0Type {
  return json0;
}

export function cloneJson0Op(op: Json0Op): Json0Op {
  return JSON.parse(JSON.stringify(op)) as Json0Op;
}

export function applyJson0(snapshot: unknown, op: Json0Op): unknown {
  return json0.apply(json0.create(snapshot), cloneJson0Op(op));
}

export function invertJson0(op: Json0Op): Json0Op {
  return json0.invert(cloneJson0Op(op));
}

export function transformJson0(
  op: Json0Op,
  otherOp: Json0Op,
  side: OtSide,
): Json0Op {
  return json0.transform(cloneJson0Op(op), cloneJson0Op(otherOp), side);
}

export function composeJson0(op1: Json0Op, op2: Json0Op): Json0Op {
  return json0.compose(cloneJson0Op(op1), cloneJson0Op(op2));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Diff two plain JSON values into a json0 operation.
 * Arrays with length changes are replaced as a whole at that path.
 */
export function diffJson0(before: unknown, after: unknown): Json0Op {
  const op: Json0Op = [];
  diffInto(before, after, [], op);
  return op;
}

function diffInto(
  before: unknown,
  after: unknown,
  path: (string | number)[],
  op: Json0Op,
): void {
  if (valuesEqual(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    diffArrays(before, after, path, op);
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    diffObjects(before, after, path, op);
    return;
  }

  if (path.length === 0) {
    // Root replace is not representable as a path component; callers should
    // partialize to an object. Fall back to no-op marker via empty path oi/od
    // is invalid in json0 — replace by composing object field updates only.
    throw new Error(
      "[sinwan ot] Cannot replace root snapshot; partialize must return an object",
    );
  }

  const parentIsList = typeof path[path.length - 1] === "number";
  if (parentIsList) {
    op.push({
      p: path.slice(),
      ld: cloneJson(before),
      li: cloneJson(after),
    });
  } else {
    op.push({
      p: path.slice(),
      od: cloneJson(before),
      oi: cloneJson(after),
    });
  }
}

function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: (string | number)[],
  op: Json0Op,
): void {
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  for (const key of beforeKeys) {
    const childPath = [...path, key];
    if (!afterKeys.has(key)) {
      op.push({ p: childPath, od: cloneJson(before[key]) });
    } else {
      diffInto(before[key], after[key], childPath, op);
    }
  }

  for (const key of afterKeys) {
    if (beforeKeys.has(key)) continue;
    op.push({ p: [...path, key], oi: cloneJson(after[key]) });
  }
}

function diffArrays(
  before: unknown[],
  after: unknown[],
  path: (string | number)[],
  op: Json0Op,
): void {
  if (before.length !== after.length) {
    if (path.length === 0) {
      throw new Error(
        "[sinwan ot] Cannot replace root array; partialize must return an object",
      );
    }
    const parentIsList = typeof path[path.length - 1] === "number";
    if (parentIsList) {
      op.push({
        p: path.slice(),
        ld: cloneJson(before),
        li: cloneJson(after),
      });
    } else {
      op.push({
        p: path.slice(),
        od: cloneJson(before),
        oi: cloneJson(after),
      });
    }
    return;
  }

  for (let i = 0; i < before.length; i++) {
    diffInto(before[i], after[i], [...path, i], op);
  }
}

/**
 * Transform every op in `stack` by `by` (left), mutating in place.
 * Drops entries that become empty after transform.
 */
export function transformStackBy(
  stack: Json0Op[],
  by: Json0Op,
  side: OtSide = "left",
): void {
  for (let i = 0; i < stack.length; i++) {
    stack[i] = transformJson0(stack[i], by, side);
  }
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].length === 0) {
      stack.splice(i, 1);
    }
  }
}
