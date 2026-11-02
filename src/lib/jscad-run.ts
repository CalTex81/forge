import * as modeling from "@jscad/modeling";
import * as THREE from "three";

export type Geom = ReturnType<typeof modeling.primitives.cube>;

export function runJscad(code: string): Geom[] {
  const m = modeling as unknown as Record<string, unknown>;
  const names = ["primitives", "booleans", "transforms", "extrusions", "hulls", "expansions", "colors", "geometries", "maths", "measurements", "text", "utils"];
  const fn = new Function(...names, `${code}\n;return typeof main==='function'?main():undefined;`);
  const out = fn(...names.map((n) => m[n]));
  const arr = (Array.isArray(out) ? out.flat(Infinity) : [out]).filter(Boolean) as Geom[];
  if (!arr.length) throw new Error("main() returned nothing");
  return arr;
}

export function geomToThree(g: Geom): THREE.BufferGeometry {
  const polys = modeling.geometries.geom3.toPolygons(g);
  const pos: number[] = [];
  for (const p of polys) {
    const v = p.vertices;
    for (let i = 1; i < v.length - 1; i++) pos.push(...v[0], ...v[i], ...v[i + 1]);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  bg.computeVertexNormals();
  return bg;
}
