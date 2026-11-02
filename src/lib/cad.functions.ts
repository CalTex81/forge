import { createServerFn } from "@tanstack/react-start";

export const generateCad = createServerFn({ method: "POST" })
  .validator((d: { prompt: string; currentCode?: string | undefined; error?: string | undefined }) => {
    if (!d?.prompt || typeof d.prompt !== "string" || d.prompt.length > 4000)
      throw new Error("Invalid prompt");
    return d;
  })
  .handler(async ({ data }) => {
    const { generateCadCode } = await import("./cad.server");
    return { code: await generateCadCode(data) };
  });
