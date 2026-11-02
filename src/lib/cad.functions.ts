import { createServerFn } from "@tanstack/react-start";

export const generateCad = createServerFn({ method: "POST" })
  .inputValidator((d: { prompt: string; currentCode?: string; error?: string }) => {
    if (!d?.prompt || typeof d.prompt !== "string" || d.prompt.length > 4000)
      throw new Error("Invalid prompt");
    return d;
  })
  .handler(async ({ data }) => {
    const { generateCadCode } = await import("./cad.server");
    return { code: await generateCadCode(data) };
  });
