import { describe, expect, it } from "vitest";

import { generateCadCode } from "@/lib/cad.server";
import { DEFAULT_LLM_SETTINGS } from "@/lib/llm-config";

/**
 * Real end-to-end run against the model server on this machine. Skipped by
 * default because CI has no Ollama — run it with:
 *
 *   FORGE_LIVE_LLM=1 npm test -- live-ollama
 *
 * Set FORGE_LIVE_MODEL to use a model other than the default.
 */
const live = process.env["FORGE_LIVE_LLM"] === "1";
const model = process.env["FORGE_LIVE_MODEL"] || DEFAULT_LLM_SETTINGS.model;

describe.skipIf(!live)("live local model", () => {
  it(
    "writes runnable JSCAD for a prompt",
    async () => {
      const code = await generateCadCode({ prompt: "a 10 mm cube", model });

      expect(code).toContain("function main");
      expect(code).not.toContain("```");
    },
    300_000,
  );
});
