/**
 * Sinway — Patches
 *
 * Minimal JSON-Patch-like ops for temporal undo/redo (zero new deps).
 * Paths are arrays of keys (not RFC 6902 pointer strings).
 */

export type PatchPath = readonly (string | number)[];

export type Patch =
  | { op: "add"; path: PatchPath; value: unknown }
  | { op: "remove"; path: PatchPath; value?: unknown }
  | { op: "replace"; path: PatchPath; value: unknown };

export type PatchPair = {
  patches: Patch[];
  inversePatches: Patch[];
};

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
 * Diff two plain JSON values into forward patches and inverse patches.
 * Arrays are compared positionally (reorders may emit coarse replaces).
 */
export function diff(before: unknown, after: unknown): PatchPair {
  const patches: Patch[] = [];
  const inversePatches: Patch[] = [];
  diffInto(before, after, [], patches, inversePatches);
  // Undo must run inverse ops in reverse chronological order.
  inversePatches.reverse();
  return { patches, inversePatches };
}

function diffInto(
  before: unknown,
  after: unknown,
  path: (string | number)[],
  patches: Patch[],
  inversePatches: Patch[],
): void {
  if (valuesEqual(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    diffArrays(before, after, path, patches, inversePatches);
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    diffObjects(before, after, path, patches, inversePatches);
    return;
  }

  // Type change or primitive / non-plain: replace whole node
  patches.push({ op: "replace", path: path.slice(), value: cloneJson(after) });
  inversePatches.push({
    op: "replace",
    path: path.slice(),
    value: cloneJson(before),
  });
}

function diffObjects(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  path: (string | number)[],
  patches: Patch[],
  inversePatches: Patch[],
): void {
  const beforeKeys = new Set(Object.keys(before));
  const afterKeys = new Set(Object.keys(after));

  for (const key of beforeKeys) {
    const childPath = [...path, key];
    if (!afterKeys.has(key)) {
      patches.push({ op: "remove", path: childPath, value: cloneJson(before[key]) });
      inversePatches.push({
        op: "add",
        path: childPath,
        value: cloneJson(before[key]),
      });
    } else {
      diffInto(before[key], after[key], childPath, patches, inversePatches);
    }
  }

  for (const key of afterKeys) {
    if (beforeKeys.has(key)) continue;
    const childPath = [...path, key];
    patches.push({ op: "add", path: childPath, value: cloneJson(after[key]) });
    inversePatches.push({ op: "remove", path: childPath, value: cloneJson(after[key]) });
  }
}

function diffArrays(
  before: unknown[],
  after: unknown[],
  path: (string | number)[],
  patches: Patch[],
  inversePatches: Patch[],
): void {
  // Length changes: replace the whole array (positional mid-removes break indices).
  if (before.length !== after.length) {
    patches.push({ op: "replace", path: path.slice(), value: cloneJson(after) });
    inversePatches.push({
      op: "replace",
      path: path.slice(),
      value: cloneJson(before),
    });
    return;
  }

  for (let i = 0; i < before.length; i++) {
    diffInto(before[i], after[i], [...path, i], patches, inversePatches);
  }
}

/**
 * Apply patches to a plain JSON value; returns a new value (does not mutate).
 * Input/output are `unknown` so before/after shapes may differ across a round-trip.
 */
export function applyPatches(
  state: unknown,
  patches: readonly Patch[],
): unknown {
  let result: unknown = cloneJson(state);
  for (const patch of patches) {
    result = applyOne(result, patch);
  }
  return result;
}

function applyOne(state: unknown, patch: Patch): unknown {
  const { path, op } = patch;
  if (path.length === 0) {
    if (op === "remove") return undefined;
    return cloneJson(patch.value);
  }

  const root = cloneJson(state);
  let parent: unknown = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    parent = getChild(parent, key);
  }

  const last = path[path.length - 1];
  if (op === "remove") {
    removeChild(parent, last);
  } else {
    setChild(parent, last, cloneJson(patch.value));
  }
  return root;
}

function getChild(parent: unknown, key: string | number): unknown {
  if (Array.isArray(parent)) {
    return parent[key as number];
  }
  if (isPlainObject(parent) || (parent !== null && typeof parent === "object")) {
    return (parent as Record<string | number, unknown>)[key];
  }
  throw new Error(`[sinwan patch] Cannot walk path at key ${String(key)}`);
}

function setChild(
  parent: unknown,
  key: string | number,
  value: unknown,
): void {
  if (Array.isArray(parent)) {
    const index = key as number;
    if (index === parent.length) {
      parent.push(value);
    } else {
      parent[index] = value;
    }
    return;
  }
  if (parent !== null && typeof parent === "object") {
    (parent as Record<string | number, unknown>)[key] = value;
    return;
  }
  throw new Error(`[sinwan patch] Cannot set key ${String(key)}`);
}

function removeChild(parent: unknown, key: string | number): void {
  if (Array.isArray(parent)) {
    const index = key as number;
    if (index === parent.length - 1) {
      parent.pop();
    } else {
      parent.splice(index, 1);
    }
    return;
  }
  if (parent !== null && typeof parent === "object") {
    delete (parent as Record<string | number, unknown>)[key];
    return;
  }
  throw new Error(`[sinwan patch] Cannot remove key ${String(key)}`);
}
