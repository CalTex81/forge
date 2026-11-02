import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LocalSetup from "@/components/LocalSetup";
import type { ForgeDesktop, SetupEvent, SetupStatus } from "@/lib/desktop-bridge";

const STATUS: SetupStatus = {
  installed: true,
  version: "client version is 0.30.9",
  serverRunning: true,
  models: ["qwen2.5-coder:7b"],
  baseUrl: "http://127.0.0.1:11434",
  error: null,
};

const SETTINGS = { baseUrl: STATUS.baseUrl, model: "qwen2.5-coder:7b" };

function installBridge(overrides: Partial<ForgeDesktop> = {}) {
  const listeners: Array<(event: SetupEvent) => void> = [];
  const pulled: string[] = [];

  const api: ForgeDesktop = {
    platform: "win32",
    status: vi.fn(async () => STATUS),
    startServer: vi.fn(async () => ({ ...STATUS, ok: true, alreadyRunning: true })),
    pullModel: vi.fn(async (model: string) => {
      pulled.push(model);
      return { ok: true };
    }),
    cancel: vi.fn(async () => ({ ok: true })),
    installOllama: vi.fn(async () => ({ ok: true })),
    onEvent: (callback) => {
      listeners.push(callback);
      return () => {};
    },
    ...overrides,
  };

  window.forge = api;
  return {
    api,
    pulled,
    emit: (event: SetupEvent) => listeners.forEach((listener) => listener(event)),
  };
}

afterEach(() => {
  delete window.forge;
});

describe("LocalSetup", () => {
  it("shows the local runtime status", async () => {
    installBridge();
    render(<LocalSetup settings={SETTINGS} onChange={() => {}} />);

    await waitFor(() => expect(screen.getAllByText("ready")).toHaveLength(2));
    expect(screen.getByText("qwen2.5-coder:7b")).toBeTruthy();
  });

  it("pulls the requested model and streams the command output", async () => {
    const { pulled, emit } = installBridge();
    render(<LocalSetup settings={SETTINGS} onChange={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("ready")).toHaveLength(2));

    fireEvent.change(screen.getByPlaceholderText("qwen2.5-coder:7b"), {
      target: { value: "qwen2.5-coder:1.5b" },
    });
    fireEvent.click(screen.getByRole("button", { name: /download/i }));

    await waitFor(() => expect(pulled).toEqual(["qwen2.5-coder:1.5b"]));

    act(() => {
      emit({ type: "start", text: "ollama pull qwen2.5-coder:1.5b" });
      emit({ type: "line", stream: "out", text: "pulling manifest" });
    });

    await waitFor(() => expect(screen.getByText("pulling manifest")).toBeTruthy());
    expect(screen.getByText("> ollama pull qwen2.5-coder:1.5b")).toBeTruthy();
  });

  it("switches to the model after a successful download", async () => {
    const { emit } = installBridge();
    const onChange = vi.fn();
    render(<LocalSetup settings={SETTINGS} onChange={onChange} />);
    await waitFor(() => expect(screen.getAllByText("ready")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /download/i }));
    act(() => {
      emit({ type: "start", text: "ollama pull qwen2.5-coder:7b" });
      emit({ type: "exit", code: 0 });
    });

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ baseUrl: STATUS.baseUrl, model: "qwen2.5-coder:7b" }),
    );
  });

  it("explains that the browser build cannot install anything", async () => {
    render(<LocalSetup settings={SETTINGS} onChange={() => {}} />);

    expect(screen.getByText(/needs the desktop build/i)).toBeTruthy();
    expect(screen.getByText(/ollama pull qwen2.5-coder:7b/)).toBeTruthy();
  });
});
