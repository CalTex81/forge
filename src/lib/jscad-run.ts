import * as modeling from "@jscad/modeling";
import * as THREE from "three";

export type Geom = ReturnType<typeof modeling.primitives.cube>;

/** The @jscad/modeling namespaces bound as bare variables inside the sandbox. */
const NAMESPACES = [
  "primitives",
  "booleans",
  "transforms",
  "extrusions",
  "hulls",
  "expansions",
  "colors",
  "geometries",
  "maths",
  "measurements",
  "text",
  "utils",
] as const;

/**
 * Local models are told the namespaces are already in scope, but they still
 * emit `import`/`require`/`export`, and the sandbox is a `new Function` body —
 * module syntax there is a syntax error, not a fixable runtime problem. Rewrite
 * those few forms onto the injected namespaces so the code runs as written.
 */
export function normalizeJscadCode(code: string): string {
  return (
    code
      // import * as modeling from "@jscad/modeling"
      .replace(
        /^[ \t]*import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"]\s*;?[ \t]*$/gm,
        "const $1 = __jscad;",
      )
      // import { primitives, booleans as bools } from "@jscad/modeling"
      .replace(/^[ \t]*import\s*\{([^}]*)\}\s*from\s+['"][^'"]+['"]\s*;?[ \t]*$/gm, (_match, names: string) => {
        const specs = names
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => name.replace(/\s+as\s+/, ": "));
        return specs.length ? `const { ${specs.join(", ")} } = __jscad;` : "";
      })
      // import modeling from "@jscad/modeling"
      .replace(
        /^[ \t]*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"]\s*;?[ \t]*$/gm,
        "const $1 = __jscad;",
      )
      // import "@jscad/modeling";
      .replace(/^[ \t]*import\s+['"][^'"]+['"]\s*;?[ \t]*$/gm, "")
      // const { primitives } = require("@jscad/modeling")
      .replace(/\brequire\s*\(/g, "__jscadRequire(")
      // export default function main() / export function main() / export const …
      .replace(/^[ \t]*export\s+default\s+/gm, "")
      .replace(/^[ \t]*export\s+(?=(?:const|let|var|function|class|async)\b)/gm, "")
  );
}

function isGeom(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  // geom3 carries polygons; geom2 carries sides. Both take the v1 methods —
  // JSCAD v2 supports 2D booleans and transforms too.
  const candidate = value as { polygons?: unknown; sides?: unknown };
  return Array.isArray(candidate.polygons) || Array.isArray(candidate.sides);
}

/**
 * JSCAD v2 is functional, but code models write is trained on v1, where shapes
 * carried `subtract`/`union`/`translate` methods. Attach those methods to the
 * geometries that come back from the namespaces so v1-style code runs instead of
 * failing with "... is not a function".
 */
function withV1Methods(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withV1Methods);
  if (!isGeom(value)) return value;

  const geom = value;
  const asGeom = geom as unknown as Geom;
  const wrapped: Record<string, unknown> = { ...geom };
  const booleanMethod = (fn: (a: Geom, b: Geom) => Geom) => (other: unknown) =>
    withV1Methods(fn(asGeom, other as Geom));
  const transformMethod = (fn: (vec: [number, number, number], a: Geom) => Geom) => (vec: unknown) =>
    withV1Methods(fn(vec as [number, number, number], asGeom));

  wrapped["subtract"] = booleanMethod((a, b) => modeling.booleans.subtract(a, b));
  wrapped["union"] = booleanMethod((a, b) => modeling.booleans.union(a, b));
  wrapped["intersect"] = booleanMethod((a, b) => modeling.booleans.intersect(a, b));
  wrapped["translate"] = transformMethod((vec, a) => modeling.transforms.translate(vec, a));
  wrapped["rotate"] = transformMethod((vec, a) => modeling.transforms.rotate(vec, a));
  wrapped["scale"] = transformMethod((vec, a) => modeling.transforms.scale(vec, a));
  wrapped["colorize"] = (color: unknown) =>
    withV1Methods(modeling.colors.colorize(color as [number, number, number, number], asGeom));
  return wrapped;
}

/** Wraps every namespace function so shapes it returns carry the v1 methods. */
function wrapNamespace(namespace: unknown): Record<string, unknown> {
  const source = (namespace ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      typeof value === "function"
        ? (...args: unknown[]) => withV1Methods((value as (...inner: unknown[]) => unknown)(...args))
        : value,
    ]),
  );
}

export function runJscad(code: string): Geom[] {
  const m = modeling as unknown as Record<string, unknown>;
  const namespace: Record<string, unknown> = {
    ...Object.fromEntries(NAMESPACES.map((name) => [name, wrapNamespace(m[name])])),
    // v1 exposed these helpers at the top level; in v2 they live under `maths`.
    vec2: wrapNamespace(modeling.maths.vec2),
    vec3: wrapNamespace(modeling.maths.vec3),
    mat4: wrapNamespace(modeling.maths.mat4),
  };
  // A `with` scope resolves the namespaces instead of declaring them, so code
  // that imports or destructures the same names (common in model output) does
  // not collide with its own bindings.
  const source = normalizeJscadCode(code).replace(/^[ \t]*['"]use strict['"];?[ \t]*$/m, "");
  const body = `with (__jscad) {\n${source}\n;return typeof main === 'function' ? main() : undefined;\n}`;
  const fn = new Function("__jscad", "__jscadRequire", body);
  const out = fn(namespace, () => namespace);
  const arr = (Array.isArray(out) ? out.flat(Infinity) : [out]).filter(Boolean) as Geom[];
  if (!arr.length) throw new Error("main() returned nothing");
  return arr;
}

export function geomToThree(g: Geom): THREE.BufferGeometry {
  const polys = modeling.geometries.geom3.toPolygons(g);
  const pos: number[] = [];
  for (const p of polys) {
    const v = p.vertices;
    for (let i = 1; i < v.length - 1; i++) pos.push(...v[0]!, ...v[i]!, ...v[i + 1]!);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  bg.computeVertexNormals();
  return bg;
}
