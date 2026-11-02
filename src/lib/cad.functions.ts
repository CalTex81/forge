import { createServerFn } from "@tanstack/react-start";

type GeneratePayload = {
  prompt: string;
  currentCode?: string | undefined;
  error?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
};

export const generateCad = createServerFn({ method: "POST" })
  .validator((d: GeneratePayload) => {
    if (!d?.prompt || typeof d.prompt !== "string" || d.prompt.length > 4000)
      throw new Error("Invalid prompt");
    return d;
  })
  .handler(async ({ data }) => {
    const { generateCadCode } = await import("./cad.server");
    return { code: await generateCadCode(data) };
  });

/** Models already installed in the local runtime, for the model picker. */
export const listModels = createServerFn({ method: "POST" })
  .validator((d: { baseUrl?: string | undefined } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const { listLocalModels } = await import("./cad.server");
    return listLocalModels(data.baseUrl);
  });
