import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";

import { listModels } from "@/lib/cad.functions";
import { DEFAULT_LLM_SETTINGS, normalizeLlmSettings, type LlmSettings } from "@/lib/llm-config";

type Props = {
  settings: LlmSettings;
  onChange: (next: LlmSettings) => void;
  onOpenSetup?: (() => void) | undefined;
};

/**
 * Picks the local model that writes the JSCAD code. Everything here talks to a
 * model server on this machine (Ollama by default) — no API keys, no cloud.
 */
export default function ModelSettings({ settings, onChange, onOpenSetup }: Props) {
  const detect = useServerFn(listModels);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [found, setFound] = useState<string[] | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function commit(nextBase: string, nextModel: string) {
    try {
      const normalized = normalizeLlmSettings({ baseUrl: nextBase, model: nextModel });
      onChange(normalized);
      setBaseUrl(normalized.baseUrl);
      setModel(normalized.model);
      setStatus("Saved — new designs will use this model.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function scan() {
    setBusy(true);
    setStatus("");
    try {
      const res = await detect({ data: { baseUrl } });
      setFound(res.models);
      setStatus(
        res.error ??
          (res.models.length
            ? `Found ${res.models.length} installed model${res.models.length === 1 ? "" : "s"}.`
            : "No models installed yet. Download one with the command below."),
      );
    } catch (error) {
      setStatus((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Tell the user straight away whether their model is actually on disk.
  useEffect(() => {
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const missing = found !== null && found.length > 0 && !found.includes(model);

  return (
    <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
      <div className="space-y-1">
        <h2 className="font-display text-lg">Local model</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Forge turns your description into JSCAD code with a model running on your own computer.
          Nothing is sent to the cloud, so it keeps working offline.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          Model server
        </span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          spellCheck={false}
          placeholder={DEFAULT_LLM_SETTINGS.baseUrl}
          className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:border-primary"
        />
      </label>

      <label className="block space-y-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          Model
        </span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          spellCheck={false}
          placeholder={DEFAULT_LLM_SETTINGS.model}
          className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs outline-none focus:border-primary"
        />
      </label>

      <div className="flex gap-2">
        <button onClick={() => commit(baseUrl, model)} className="btn-primary flex-1">
          Use this model
        </button>
        <button onClick={scan} disabled={busy} className="btn-ghost">
          {busy ? "Looking…" : "Detect"}
        </button>
      </div>

      {found && found.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            Installed
          </p>
          <div className="flex flex-wrap gap-2">
            {found.map((name) => (
              <button
                key={name}
                onClick={() => commit(baseUrl, name)}
                className={`rounded-full border px-3 py-1 font-mono text-[11px] ${
                  name === model
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground hover:border-primary"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {missing && (
        <div className="space-y-2 rounded-md border border-primary/40 bg-card p-3">
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            {model} isn&apos;t installed yet. Setup installs it for you with one click.
          </p>
          {onOpenSetup && (
            <button onClick={onOpenSetup} className="btn-ghost">
              Open Setup
            </button>
          )}
        </div>
      )}

      {status && (
        <p className="rounded-md border border-border bg-card p-3 font-mono text-[11px] text-muted-foreground">
          {status}
        </p>
      )}

      <div className="space-y-2 border-t border-border pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          Setup
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Install Ollama (ollama.com), then in a terminal download a code model once:
        </p>
        <pre className="overflow-x-auto rounded-md bg-card p-3 font-mono text-[11px] leading-relaxed">
          {"ollama pull qwen2.5-coder:7b\nollama serve"}
        </pre>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Smaller models answer faster; larger ones design trickier parts more reliably. Any
          OpenAI-compatible server on localhost works too — point the URL at it.
        </p>
      </div>
    </div>
  );
}
