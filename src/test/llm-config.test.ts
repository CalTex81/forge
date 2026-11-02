import { describe, expect, it } from "vitest";

import { pickInstalledModel } from "@/lib/llm-config";

describe("pickInstalledModel", () => {
  it("keeps the configured model when it is installed", () => {
    expect(pickInstalledModel(["qwen2.5-coder:7b"], "qwen2.5-coder:7b")).toBe("qwen2.5-coder:7b");
  });

  it("falls back to the same model family", () => {
    expect(pickInstalledModel(["qwen2.5-coder:1.5b", "llama3.2:3b"], "qwen2.5-coder:7b")).toBe(
      "qwen2.5-coder:1.5b",
    );
  });

  it("prefers a code model when the family is missing", () => {
    expect(pickInstalledModel(["llama3.2:3b", "qwen2.5-coder:1.5b"], "codellama:7b")).toBe(
      "qwen2.5-coder:1.5b",
    );
  });

  it("takes whatever is installed as a last resort", () => {
    expect(pickInstalledModel(["llama3.2:3b"], "qwen2.5-coder:7b")).toBe("llama3.2:3b");
  });

  it("returns null when nothing is installed", () => {
    expect(pickInstalledModel([], "qwen2.5-coder:7b")).toBeNull();
  });
});
