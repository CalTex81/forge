import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { generateCadCode, listLocalModels } from "@/lib/cad.server";
import { DEFAULT_LLM_SETTINGS, normalizeLlmSettings, ollamaRoot } from "@/lib/llm-config";

// Stands in for Ollama: an OpenAI-compatible chat endpoint plus /api/tags.
let server: Server;
let baseUrl: string;
let requests: Array<{
  path: string;
  body: { model?: string; messages?: Array<{ content?: string }> };
}> = [];
let mode: "ok" | "missing-model" = "ok";

/** A port nothing is listening on, so connection failures are real ones. */
async function closedPortUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}/v1`;
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push({ path: req.url ?? "", body });

      if (req.url?.endsWith("/api/tags")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }, { name: "llama3.2:3b" }] }),
        );
        return;
      }
      if (mode === "missing-model") {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: 'model "nope" not found, try pulling it first',
              type: "invalid_request_error",
            },
          }),
        );
        return;
      }

      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta: object, finish: string | null) =>
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-1",
            object: "chat.completion.chunk",
            created: 1,
            model: "qwen2.5-coder:7b",
            choices: [{ index: 0, delta, finish_reason: finish }],
          })}\n\n`,
        );
      send({ role: "assistant", content: "```javascript\n" }, null);
      send({ content: "function main() {\n  return primitives.cube({ size: 10 });\n}\n" }, null);
      send({ content: "```" }, "stop");
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests = [];
  mode = "ok";
});

describe("local model settings", () => {
  it("appends /v1 and keeps localhost", () => {
    expect(normalizeLlmSettings({ baseUrl: "http://localhost:11434", model: "m" })).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "m",
    });
  });

  it("falls back to the default local model", () => {
    expect(normalizeLlmSettings()).toEqual(DEFAULT_LLM_SETTINGS);
  });

  it("refuses remote hosts so nothing leaves the machine", () => {
    expect(() => normalizeLlmSettings({ baseUrl: "https://api.openai.com/v1" })).toThrow(
      /on this machine/,
    );
  });

  it("derives the Ollama API root from the OpenAI-compatible URL", () => {
    expect(ollamaRoot("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
  });
});

describe("generateCadCode against a local OpenAI-compatible server", () => {
  it("sends the prompt to the local model and strips markdown fences", async () => {
    const code = await generateCadCode({
      prompt: "a 10mm cube",
      baseUrl,
      model: "qwen2.5-coder:7b",
    });

    expect(code).toBe("function main() {\n  return primitives.cube({ size: 10 });\n}");
    expect(requests[0]?.path).toBe("/v1/chat/completions");
    expect(requests[0]?.body.model).toBe("qwen2.5-coder:7b");
    expect(requests[0]?.body.messages?.at(-1)?.content).toContain("a 10mm cube");
  });

  it("explains how to pull a missing model", async () => {
    mode = "missing-model";
    await expect(generateCadCode({ prompt: "x", baseUrl, model: "nope" })).rejects.toThrow(
      /ollama pull nope/,
    );
  });

  it("tells the user to start their model server when it is down", async () => {
    const url = await closedPortUrl();
    await expect(generateCadCode({ prompt: "x", baseUrl: url, model: "m" })).rejects.toThrow(
      /No model server is answering/,
    );
  });
});

describe("listLocalModels", () => {
  it("returns models installed on this machine", async () => {
    await expect(listLocalModels(baseUrl)).resolves.toEqual({
      models: ["llama3.2:3b", "qwen2.5-coder:7b"],
    });
  });

  it("reports an error instead of throwing when nothing is listening", async () => {
    const result = await listLocalModels(await closedPortUrl());
    expect(result.models).toEqual([]);
    expect(result.error).toMatch(/No model server/);
  });
});
