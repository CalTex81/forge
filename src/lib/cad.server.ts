import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const SYSTEM = `You are a CAD engineer writing JSCAD (@jscad/modeling v2) JavaScript.
Output ONLY the code, no markdown fences, no prose.
Rules:
- The variables primitives, booleans, transforms, extrusions, hulls, expansions, colors, geometries, maths, measurements, text, utils are already in scope (each is the matching @jscad/modeling namespace). Do NOT import or require anything.
- Define "function main() { ... }" returning a geom3 or an array of geom3.
- Units are millimetres. Use segments: 48 or more for round shapes.
- Use colors.colorize([r,g,b], shape) for color where helpful.
- Write clean, well-commented, parametric code (constants at top).
- When given existing code and a change request, return the FULL updated code.`;

export async function generateCadCode(input: {
  prompt: string;
  currentCode?: string;
  error?: string;
}) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI is not configured.");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  let user = input.currentCode
    ? `Current code:\n${input.currentCode}\n\nChange request: ${input.prompt}`
    : `Design this: ${input.prompt}`;
  if (input.error) user += `\n\nThe previous code failed with this error, fix it: ${input.error}`;

  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions: SYSTEM,
    messages: [{ role: "user", content: user }],
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  } as Parameters<typeof streamText>[0]);
  let text = "";
  try {
    text = await result.text;
  } catch (e: unknown) {
    const err = e as { statusCode?: number; message?: string };
    if (err.statusCode === 429) throw new Error("Too many requests — please wait a moment.");
    if (err.statusCode === 402) throw new Error("AI credits exhausted. Add credits to continue.");
    throw new Error(err.message || "AI request failed");
  }
  return text.replace(/^```[a-z]*\n?/i, "").replace(/```\s*$/, "").trim();
}
