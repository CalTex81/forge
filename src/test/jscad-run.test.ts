import { describe, expect, it } from "vitest";

import { normalizeJscadCode, runJscad } from "@/lib/jscad-run";

/** Number of polygons in the first geometry, so tests prove real geometry came back. */
function polygonsOf(code: string): number {
  const geoms = runJscad(code);
  return geoms[0]?.polygons.length ?? 0;
}

describe("runJscad", () => {
  it("runs plain code that uses the injected namespaces", () => {
    expect(polygonsOf("const main = () => primitives.cube({ size: 10 });")).toBeGreaterThan(0);
  });

  it("runs code that imports named namespaces", () => {
    const code = [
      'import { primitives, transforms } from "@jscad/modeling";',
      "const main = () => transforms.translate([0, 0, 5], primitives.cube({ size: 10 }));",
    ].join("\n");
    expect(polygonsOf(code)).toBeGreaterThan(0);
  });

  it("runs code that imports the whole module as a namespace", () => {
    const code = [
      'import * as modeling from "@jscad/modeling";',
      "const main = () => modeling.primitives.cube({ size: 10 });",
    ].join("\n");
    expect(polygonsOf(code)).toBeGreaterThan(0);
  });

  it("runs code that uses require", () => {
    const code = [
      'const { primitives } = require("@jscad/modeling");',
      "const main = () => primitives.cube({ size: 10 });",
    ].join("\n");
    expect(polygonsOf(code)).toBeGreaterThan(0);
  });

  it("runs code that exports main", () => {
    expect(polygonsOf('export default function main() { return primitives.cube({ size: 10 }); }')).toBeGreaterThan(0);
    expect(polygonsOf('export function main() { return primitives.cube({ size: 10 }); }')).toBeGreaterThan(0);
  });

  it("handles multi-line import lists and aliases", () => {
    const code = [
      "import {",
      "  primitives,",
      "  transforms as tf,",
      '} from "@jscad/modeling";',
      "const main = () => tf.translate([0, 0, 2], primitives.cube({ size: 10 }));",
    ].join("\n");
    expect(polygonsOf(code)).toBeGreaterThan(0);
  });

  it("supports v1-style chained boolean methods", () => {
    const code = [
      "const main = () => {\n",
      "  const body = primitives.cube({ size: 10 });\n",
      "  const hole = primitives.cube({ size: 4 });\n",
      "  return body.subtract(hole);\n",
      "};",
    ].join("");
    const plain = polygonsOf("const main = () => primitives.cube({ size: 10 });");
    expect(polygonsOf(code)).toBeGreaterThan(plain);
  });

  it("supports chained transforms and mixed v1/v2 style", () => {
    const code = [
      "const main = () => {\n",
      "  const part = primitives.cube({ size: 10 }).translate([0, 0, 5]).colorize([1, 0, 0, 1]);\n",
      "  return booleans.union(part, primitives.cube({ size: 4 }).translate([0, 0, 12]));\n",
      "};",
    ].join("");
    expect(polygonsOf(code)).toBeGreaterThan(0);
  });

  it("supports v1-style chaining on 2D shapes", () => {
    const code = [
      "const main = () => {\n",
      "  const ring = primitives.circle({ radius: 10, segments: 24 }).subtract(primitives.circle({ radius: 4, segments: 24 }));\n",
      "  return extrusions.extrudeLinear({ height: 2 }, ring);\n",
      "};",
    ].join("");
    expect(polygonsOf(code)).toBeGreaterThan(0);
  });

  it("exposes the maths helpers models expect at the top level", () => {
    const code = [
      "const main = () => transforms.translate(vec3.create(0, 0, 5), primitives.cube({ size: 10 }));",
    ].join("\n");
    expect(polygonsOf(code)).toBeGreaterThan(0);
  });

  it("still rejects code that defines no main", () => {
    expect(() => runJscad("const notMain = () => primitives.cube({ size: 10 });")).toThrow("main() returned nothing");
  });
});

describe("normalizeJscadCode", () => {
  it("leaves plain code alone", () => {
    const code = "const main = () => primitives.cube({ size: 10 });";
    expect(normalizeJscadCode(code)).toBe(code);
  });

  it("removes module syntax that cannot run in the sandbox", () => {
    const code = [
      'import * as modeling from "@jscad/modeling";',
      'const { booleans } = require("@jscad/modeling");',
      "export const main = () => modeling.primitives.cube({ size: 10 });",
    ].join("\n");
    const normalized = normalizeJscadCode(code);
    expect(normalized).not.toMatch(/^\s*import\b/m);
    expect(normalized).not.toMatch(/^\s*export\b/m);
    expect(normalized).toContain("const modeling = __jscad;");
  });

  it("is idempotent", () => {
    const once = normalizeJscadCode('import { primitives } from "@jscad/modeling";\nconst main = () => primitives.cube();');
    expect(normalizeJscadCode(once)).toBe(once);
  });
});
