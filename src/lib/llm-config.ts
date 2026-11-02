/**
 * Settings for the local language model that writes the JSCAD code.
 *
 * Everything here is plain data + pure helpers so it can be imported from both
 * the browser (where settings live in localStorage) and the server handler
 * (which is what actually talks to the model).
 */

export type LlmSettingsInput = {
  baseUrl?: string | undefined;
  model?: string | undefined;
};

export type LlmSettings = {
  /** OpenAI-compatible base URL of a model server running on this machine. */
  baseUrl: string;
  /** Model tag as the local runtime knows it, e.g. "qwen2.5-coder:7b". */
  model: string;
};

/** Ollama, running on the default port with a small code model pulled. */
export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "qwen2.5-coder:7b",
};

const STORAGE_KEY = "forge.local-llm.v1";

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

/**
 * Validates and canonicalises settings coming from the UI.
 *
 * The model server must be on this machine: the app is a local, offline-first
 * desktop tool, so a remote host is almost always a typo — and rejecting it
 * keeps the hosted web build from being usable as an open proxy.
 */
export function normalizeLlmSettings(input?: LlmSettingsInput | null): LlmSettings {
  const rawBase = (input?.baseUrl ?? "").trim() || DEFAULT_LLM_SETTINGS.baseUrl;
  const model = (input?.model ?? "").trim() || DEFAULT_LLM_SETTINGS.model;

  let url: URL;
  try {
    url = new URL(rawBase);
  } catch {
    throw new Error(
      `"${rawBase}" is not a valid URL. It should look like ${DEFAULT_LLM_SETTINGS.baseUrl}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The model server URL must start with http:// or https://");
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error(
      "The model must run on this machine. Use localhost or 127.0.0.1 so nothing leaves your computer.",
    );
  }

  // Accept both "http://host:11434" and "http://host:11434/v1".
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/v1") ? path : `${path}/v1`;
  url.search = "";
  url.hash = "";

  return { baseUrl: url.toString().replace(/\/$/, ""), model };
}

/** `http://127.0.0.1:11434/v1` -> `http://127.0.0.1:11434` (Ollama's native API root). */
export function ollamaRoot(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace(/\/v1\/?$/, "");
  url.search = "";
  url.hash = "";
  return `${url.origin}${url.pathname}`.replace(/\/$/, "");
}

/**
 * Chooses the model to actually run when the configured one is missing: the
 * same family first (qwen2.5-coder:7b → qwen2.5-coder:1.5b), then anything
 * code-flavoured, then whatever is installed. Null when nothing is available.
 */
export function pickInstalledModel(installed: string[], wanted: string): string | null {
  const names = installed.filter((name) => name.trim());
  if (names.length === 0) return null;
  if (names.includes(wanted)) return wanted;

  const family = wanted.split(":")[0]?.trim().toLowerCase() ?? "";
  if (family) {
    const sameFamily = names.find((name) => name.split(":")[0]?.trim().toLowerCase() === family);
    if (sameFamily) return sameFamily;
  }

  return names.find((name) => /coder|code|starcoder|deepseek/i.test(name)) ?? names[0] ?? null;
}

export function loadLlmSettings(): LlmSettings {
  if (typeof window === "undefined") return DEFAULT_LLM_SETTINGS;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_LLM_SETTINGS;
    const parsed = JSON.parse(stored) as Partial<LlmSettings>;
    return normalizeLlmSettings(parsed);
  } catch {
    return DEFAULT_LLM_SETTINGS;
  }
}

export function saveLlmSettings(settings: LlmSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable (private mode); settings then last for the session only.
  }
}
