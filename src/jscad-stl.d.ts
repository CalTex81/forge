declare module "@jscad/stl-serializer" {
  export function serialize(options: { binary?: boolean }, ...objects: unknown[]): unknown[];
}

declare module "@jscad/3mf-serializer" {
  export function serialize(
    options: { unit?: string; metadata?: boolean; compress?: boolean },
    ...objects: unknown[]
  ): (ArrayBuffer | string)[];
}
