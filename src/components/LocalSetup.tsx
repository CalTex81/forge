import { useEffect, useRef, useState } from "react";

import { getDesktop, type SetupEvent, type SetupStatus } from "@/lib/desktop-bridge";
import { DEFAULT_LLM_SETTINGS, type LlmSettings } from "@/lib/llm-config";

type Line = { kind: "cmd" | "out" | "err" | "info"; text: string };

type Props = {
  settings: LlmSettings;
  onChange: (next: LlmSettings) => void;
};

const MANUAL = [
  "ollama pull qwen2.5-coder:7b",
  "ollama serve",
].join("\n");

/**
 * The Setup tab: a small, real terminal for the two things that make Forge
 * work — having Ollama installed and having a model on disk. Commands run in
 * the desktop shell (where Node can spawn processes) and their output streams
 * back into the pane below. In a browser it degrades to copyable commands.
 */
export default function LocalSetup({ settings, onChange }: Props) {
  const desktop = getDesktop();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [model, setModel] = useState(settings.model);
  const [lines, setLines] = useState<Line[]>([
    desktop
      ? { kind: "info", text: "Forge terminal — every command runs on this machine." }
      : { kind: "info", text: "Installing from the app needs the desktop build. Commands are shown below." },
  ]);
  const [busy, setBusy] = useState<"" | "start" | "pull">("");
  const [pulling, setPulling] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef(model);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  function append(line: Line) {
    setLines((prev) => [...prev.slice(-400), line]);
  }

  async function refresh(): Promise<SetupStatus | null> {
    if (!desktop) return null;
    try {
      const next = await desktop.status();
      setStatus(next);
      return next;
    } catch (error) {
      append({ kind: "err", text: (error as Error).message });
      return null;
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onEvent((event: SetupEvent) => {
      if (event.type === "start") {
        append({ kind: "cmd", text: `> ${event.text}` });
        return;
      }
      if (event.type === "line") {
        append({ kind: event.stream === "err" ? "err" : "out", text: event.text });
        return;
      }

      setPulling(false);
      setBusy("");
      if (event.code === 0) {
        append({ kind: "info", text: "Done." });
      } else {
        append({ kind: "err", text: event.text || `Stopped with exit code ${event.code}.` });
      }

      void (async () => {
        const next = await refresh();
        const pulled = modelRef.current;
        if (event.code === 0 && next?.models.includes(pulled)) {
          onChange({ ...settings, model: pulled });
          append({ kind: "info", text: `Forge will now use ${pulled}.` });
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktop]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [lines]);

  async function installOllama() {
    if (!desktop) return;
    append({ kind: "cmd", text: "> open ollama.com/download" });
    await desktop.installOllama();
    append({
      kind: "info",
      text: "Finish the installer, then come back here and press “Start Ollama”.",
    });
  }

  async function startServer() {
    if (!desktop) return;
    setBusy("start");
    append({ kind: "cmd", text: "> ollama serve" });
    try {
      const result = await desktop.startServer();
      setStatus(result);
      append(
        result.serverRunning
          ? {
              kind: "info",
              text: result.alreadyRunning ? "Ollama is already running." : "Ollama is running.",
            }
          : { kind: "err", text: result.error ?? "Ollama did not start." },
      );
    } catch (error) {
      append({ kind: "err", text: (error as Error).message });
    } finally {
      setBusy("");
    }
  }

  async function pull() {
    if (!desktop || pulling) return;
    const target = model.trim();
    if (!target) return;
    setBusy("pull");
    setPulling(true);
    try {
      const result = await desktop.pullModel(target);
      if (!result.ok) {
        append({ kind: "err", text: result.error ?? "Could not start the download." });
        setPulling(false);
        setBusy("");
      }
    } catch (error) {
      append({ kind: "err", text: (error as Error).message });
      setPulling(false);
      setBusy("");
    }
  }

  const models = status?.models ?? [];
  const wanted = settings.model;
  const installed = models.includes(wanted);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-4 border-b border-border p-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg">Setup</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Forge needs the Ollama runtime and one code model. Everything installs on this machine,
            so nothing is sent to the cloud.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
          <StatusRow label="Ollama" ok={Boolean(status?.installed)} detail={status?.version ?? undefined} />
          <StatusRow
            label="Model server"
            ok={Boolean(status?.serverRunning)}
            detail={status?.serverRunning ? status?.baseUrl : undefined}
          />
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <button
              onClick={installOllama}
              disabled={!desktop}
              className="btn-ghost flex-1 disabled:opacity-50"
            >
              1 · Install Ollama
            </button>
            <button
              onClick={startServer}
              disabled={!desktop || busy !== "" || Boolean(status?.serverRunning)}
              className="btn-ghost flex-1 disabled:opacity-50"
            >
              {busy === "start" ? "Starting…" : "2 · Start Ollama"}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void pull();
              }}
              spellCheck={false}
              placeholder={DEFAULT_LLM_SETTINGS.model}
              className="min-w-0 flex-1 rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:border-primary"
            />
            <button
              onClick={pull}
              disabled={!desktop || pulling || !model.trim()}
              className="btn-primary disabled:opacity-50"
            >
              {pulling ? "Downloading…" : busy === "pull" ? "…" : "3 · Download"}
            </button>
          </div>
          {pulling && (
            <button onClick={() => void desktop?.cancel()} className="btn-ghost w-full">
              Cancel download
            </button>
          )}
        </div>

        {models.length > 0 && (
          <div className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
              Installed on this machine
            </p>
            <div className="flex flex-wrap gap-2">
              {models.map((name) => (
                <button
                  key={name}
                  onClick={() => {
                    setModel(name);
                    onChange({ ...settings, model: name });
                    append({ kind: "info", text: `Forge will now use ${name}.` });
                  }}
                  className={`rounded-full border px-3 py-1 font-mono text-[11px] ${
                    name === wanted
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground hover:border-primary"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
            {!installed && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                <span className="text-primary">{wanted}</span> isn&apos;t installed yet. Download it
                above, or click one of the models that is.
              </p>
            )}
          </div>
        )}

        {!desktop && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              In the desktop app this tab installs everything with one click. In the browser, run
              these in a terminal:
            </p>
            <pre className="overflow-x-auto rounded-md bg-card p-3 font-mono text-[11px] leading-relaxed">
              {MANUAL}
            </pre>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-[oklch(0.14_0.012_250)]">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Terminal
          </span>
          <button
            onClick={() => setLines([])}
            className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed">
          {lines.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
          {lines.map((line, index) => (
            <p
              key={index}
              className={
                line.kind === "cmd"
                  ? "text-primary"
                  : line.kind === "err"
                    ? "text-destructive"
                    : line.kind === "info"
                      ? "text-muted-foreground"
                      : "text-foreground/80"
              }
            >
              {line.text}
            </p>
          ))}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  );
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string | undefined }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
        <span className={ok ? "text-primary" : "text-destructive"}>{ok ? "ready" : "missing"}</span>
      </div>
      {detail && <p className="mt-1 truncate text-muted-foreground" title={detail}>{detail}</p>}
    </div>
  );
}
