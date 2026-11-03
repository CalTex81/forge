import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

import { normalizeLlmSettings, ollamaRoot, type LlmSettings } from "./llm-config";

const SYSTEM = `You are a CAD engineer writing JSCAD (@jscad/modeling v2) JavaScript.
Output ONLY the code, no markdown fences, no prose.
Rules:
- The variables primitives, booleans, transforms, extrusions, hulls, expansions, colors, geometries, maths, measurements, text, utils are already in scope (each is the matching @jscad/modeling namespace). Do NOT import or require anything.
- Define "function main() { ... }" returning a geom3 or an array of geom3.
- This is JSCAD v2, which is functional: combine shapes with booleans.subtract(a, b), booleans.union(a, b), booleans.intersect(a, b). Never chain v1 methods such as a.subtract(b), a.union(b) or a.translate([...]) — those do not exist here; use transforms.translate([...], a) instead.
- Units are millimetres. Use segments: 48 or more for round shapes.
- Use colors.colorize([r,g,b], shape) for color where helpful.
- Write clean, well-commented, parametric code (constants at top).
- When given existing code and a change request, return the FULL updated code.`;

/** Local models are slow, but they should never hang the UI forever. */
const GENERATE_TIMEOUT_MS = 5 * 60 * 1000;
const PROBE_TIMEOUT_MS = 4000;

export type GenerateCadInput = {
  prompt: string;
  currentCode?: string | undefined;
  error?: string | undefined;
  /** Overrides the defaults from llm-config; usually the user's saved settings. */
  model?: string | undefined;
  baseUrl?: string | undefined;
};

function stripCodeFences(text: string): string {
  const withoutFence = text
    .replace(/^\s*```[a-z]*\s*\n?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  // Some local models prepend a sentence before the code block; keep the code.
  const firstCode = withoutFence.search(
    /(^|\n)\s*(function\s+main|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=)/,
  );
  return firstCode > 0 ? withoutFence.slice(firstCode).trim() : withoutFence;
}

/** Turns low-level fetch/model errors into something a desktop user can act on. */
export function describeLlmError(error: unknown, settings: LlmSettings): Error {
  const parts = [
    error instanceof Error ? error.message : String(error ?? ""),
    String((error as { cause?: unknown })?.cause ?? ""),
    String((error as { responseBody?: unknown })?.responseBody ?? ""),
  ];
  const raw = parts.join(" ").replace(/\s+/g, " ").trim();
  const status = (error as { statusCode?: unknown })?.statusCode;
  const root = ollamaRoot(settings.baseUrl);

  if (
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|Failed to fetch|NetworkError|ECONNRESET|Cannot connect to API|bad port/i.test(
      raw,
    )
  ) {
    return new Error(
      `No model server is answering at ${root}. Start it first — with Ollama that's "ollama serve" — then try again.`,
    );
  }
  if (status === 404 || /not found|no such model|try pulling/i.test(raw)) {
    return new Error(
      `The model "${settings.model}" isn't installed yet. Download it with: ollama pull ${settings.model}`,
    );
  }
  if (/abort|timeout|timed out/i.test(raw)) {
    return new Error(
      "The local model took too long and was stopped. Try a smaller model or a shorter prompt.",
    );
  }
  if (status === 429) {
    return new Error("The local model server is busy. Wait a moment and try again.");
  }
  return new Error(raw || "The local model returned no code. Please try again.");
}

function createLocalProvider(baseUrl: string) {
  return createOpenAI({
    baseURL: baseUrl,
    // Ollama and friends ignore the key, but the OpenAI client requires one.
    apiKey: "local",
  });
}

export async function generateCadCode(input: GenerateCadInput): Promise<string> {
  const settings = normalizeLlmSettings({ baseUrl: input.baseUrl, model: input.model });

  let user = input.currentCode
    ? `Current code:\n${input.currentCode}\n\nChange request: ${input.prompt}`
    : `Design this: ${input.prompt}`;
  if (input.error) user += `\n\nThis code failed with an error, fix it: ${input.error}`;

  const provider = createLocalProvider(settings.baseUrl);
  let text = "";
  let streamErr: unknown;

  try {
    const result = streamText({
      model: provider.chat(settings.model),
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      temperature: 0.2,
      abortSignal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      maxRetries: 0,
    } as Parameters<typeof streamText>[0]);

    for await (const part of result.fullStream) {
      if (part.type === "text-delta") text += (part as { text?: string }).text ?? "";
      else if (part.type === "error") streamErr = part.error;
    }
  } catch (error) {
    streamErr ??= error;
  }

  const code = stripCodeFences(text);
  if (streamErr || !code)
    throw describeLlmError(streamErr ?? new Error(rawMessageFrom(text)), settings);
  return code;
}

function rawMessageFrom(text: string): string {
  return text.trim() ? text.trim().slice(0, 400) : "The model replied without any code.";
}

/**
 * Lists models the local runtime already has on disk, so the UI can offer them
 * instead of asking the user to type an exact tag.
 */
export async function listLocalModels(baseUrl?: string | undefined): Promise<{
  models: string[];
  error?: string;
}> {
  const settings = normalizeLlmSettings({ baseUrl });
  const url = `${ollamaRoot(settings.baseUrl)}/api/tags`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return { models: [], error: `The model server answered ${res.status} at ${url}.` };
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b));
    return { models };
  } catch {
    return {
      models: [],
      error: `No model server is answering at ${ollamaRoot(settings.baseUrl)}. Start Ollama, then press Detect again.`,
    };
  }
}
