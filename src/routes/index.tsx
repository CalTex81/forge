import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { generateCad } from "@/lib/cad.functions";
import type { Geom } from "@/lib/jscad-run";

const Viewer = lazy(() => import("@/components/Viewer"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Forge — AI Text-to-CAD" },
      { name: "description", content: "Describe a part in words, get parametric CAD code and an interactive 3D model you can refine and download as STL." },
      { property: "og:title", content: "Forge — AI Text-to-CAD" },
      { property: "og:description", content: "Describe a part, get a 3D CAD model. Refine with AI, download STL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Msg = { role: "user" | "ai"; text: string };
const EXAMPLES = ["A mounting bracket with 4 screw holes", "A hex nut M10", "A coffee mug with handle", "A gear with 20 teeth"];

function Index() {
  const gen = useServerFn(generateCad);
  const [code, setCode] = useState("");
  const [geoms, setGeoms] = useState<Geom[] | null>(null);
  const [err, setErr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [tab, setTab] = useState<"chat" | "code">("chat");
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function execute(src: string) {
    const { runJscad } = await import("@/lib/jscad-run");
    try {
      const g = runJscad(src);
      setGeoms(g);
      setErr("");
      return null;
    } catch (e) {
      const m = (e as Error).message;
      setErr(m);
      return m;
    }
  }

  async function submit(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setPrompt("");
    setMsgs((m) => [...m, { role: "user", text }]);
    try {
      const { code: c } = await gen({ data: { prompt: text, currentCode: code || undefined } });
      setCode(c);
      let failure = await execute(c);
      if (failure) {
        setMsgs((m) => [...m, { role: "ai", text: "Code errored — auto-fixing…" }]);
        const { code: c2 } = await gen({ data: { prompt: text, currentCode: c, error: failure } });
        setCode(c2);
        failure = await execute(c2);
      }
      setMsgs((m) => [...m, { role: "ai", text: failure ? `Couldn't run: ${failure}` : code ? "Updated the model." : "Model generated." }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "ai", text: `Error: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function download(kind: "stl" | "js") {
    let blob: Blob;
    let name: string;
    if (kind === "js") {
      blob = new Blob([code], { type: "text/javascript" });
      name = "model.jscad.js";
    } else {
      const ser = await import("@jscad/stl-serializer");
      const data = ser.serialize({ binary: true }, ...(geoms ?? []));
      blob = new Blob(data as BlobPart[], { type: "model/stl" });
      name = "model.stl";
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground lg:flex-row">
      <section className="relative h-[52dvh] shrink-0 border-b border-border lg:h-full lg:flex-1 lg:border-b-0 lg:border-r">
        <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between p-4">
          <div className="font-display text-xl tracking-tight">
            Forge<span className="text-primary">.</span>
            <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">text → cad</span>
          </div>
          {geoms && (
            <div className="flex gap-2">
              <button onClick={() => download("stl")} className="btn-primary">STL ↓</button>
              <button onClick={() => download("js")} className="btn-ghost">Code ↓</button>
            </div>
          )}
        </header>
        {mounted && geoms ? (
          <Suspense fallback={null}>
            <Viewer geoms={geoms} />
          </Suspense>
        ) : (
          <div className="blueprint flex h-full items-center justify-center p-8 text-center">
            <div>
              <p className="font-display text-3xl sm:text-5xl">{busy ? "Drafting…" : "Describe a part."}</p>
              <p className="mt-3 font-mono text-xs text-muted-foreground">Drag to rotate · scroll/pinch to zoom</p>
            </div>
          </div>
        )}
        {busy && geoms && <div className="absolute bottom-4 left-4 font-mono text-xs text-primary animate-pulse">regenerating…</div>}
        {err && <div className="absolute bottom-4 left-4 right-24 rounded bg-destructive/90 p-2 font-mono text-xs text-destructive-foreground">{err}</div>}
      </section>

      <aside className="flex min-h-0 flex-1 flex-col lg:w-[440px] lg:flex-none">
        <div className="flex border-b border-border font-mono text-xs uppercase tracking-widest">
          {(["chat", "code"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 py-3 ${tab === t ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === "chat" ? (
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {msgs.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Try one:</p>
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => submit(e)} className="block w-full rounded-md border border-border p-3 text-left text-sm hover:border-primary">{e}</button>
                ))}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`rounded-md p-3 text-sm ${m.role === "user" ? "ml-8 bg-secondary" : "mr-8 border border-border font-mono text-xs text-muted-foreground"}`}>{m.text}</div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} className="flex-1 resize-none bg-card p-4 font-mono text-xs leading-relaxed outline-none" placeholder="// generated JSCAD code appears here" />
            <button onClick={() => execute(code)} className="btn-primary m-3">Run code ▸</button>
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); submit(prompt); }} className="flex gap-2 border-t border-border p-3">
          <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={code ? "Ask for a change… e.g. make it taller" : "Describe what to build…"} className="flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:border-primary" />
          <button disabled={busy} className="btn-primary disabled:opacity-50">{busy ? "…" : "Go"}</button>
        </form>
      </aside>
    </div>
  );
}
