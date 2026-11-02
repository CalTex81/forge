# Forge — text → CAD, on your own machine

Describe a part in words. A language model **running on your computer** writes parametric
[JSCAD](https://openjscad.xyz) code, the app executes it in the browser context and renders an
interactive 3D model you can refine, edit and export as STL.

Nothing is sent to the cloud: the site is packaged as a Windows app that serves itself from a
local port, and the model server is on `localhost`.

## Install

Download `Forge Setup 1.0.0.exe` from the latest GitHub release and run it. The installer is
per-user (no admin required) and lets you pick the install directory. It is unsigned, so Windows
SmartScreen will ask for confirmation on first run.

## Get the model (inside the app)

Forge needs [Ollama](https://ollama.com) and one code model. The **Setup** tab is a small terminal
that does both for you — everything runs on this machine:

1. **Install Ollama** — opens the official download; run the installer.
2. **Start Ollama** — runs `ollama serve` for you and waits until the local server answers.
3. **Download** — runs `ollama pull qwen2.5-coder:7b` (or any model name you type) and streams its
   progress into the terminal pane. Small models such as `qwen2.5-coder:1.5b` download and answer
   faster; larger ones design trickier parts more reliably.

The tab also lists the models already on disk, and picking one makes it the active model. If the
saved model is missing, Forge falls back to an installed model of the same family rather than
failing on the first prompt.

Any OpenAI-compatible server on localhost works too (LM Studio, `llama-server`, …) — point the
**Model** tab at its URL. Settings are stored per user, and only loopback URLs are accepted.

## Build the Windows installer

```bash
npm install
npm run desktop:dist
```

That produces `release/Forge Setup 1.0.0.exe` — a normal NSIS installer. Requirements are bundled;
the installer is unsigned, so Windows SmartScreen will ask for confirmation on first run.

## Run without packaging

```bash
npm run desktop:build   # compiles the app into .output/ for a local Node server
npm run desktop:start   # launches the Electron window
```

## Develop with hot reload

```bash
npm run dev                                   # terminal 1 — Vite dev server on :8080
FORGE_DEV_URL=http://localhost:8080 npx electron .   # terminal 2
```

On PowerShell use `$env:FORGE_DEV_URL="http://localhost:8080"; npx electron .`.

## Verify

```bash
npm test              # unit + UI tests (fake model server, no downloads)
npm run desktop:build # production server bundle
npm run desktop:smoke # launches the real app, checks the preload bridge and Ollama status
```

A real end-to-end run against the model on this machine is opt-in because it needs Ollama:

```bash
FORGE_LIVE_LLM=1 FORGE_LIVE_MODEL=qwen2.5-coder:1.5b npm test -- live-ollama
```

## How it fits together

| Piece | Role |
| --- | --- |
| `electron/main.cjs` | Picks a free port, boots the compiled server from `resources/output/server/index.mjs`, opens a window on `http://127.0.0.1:<port>`. Also owns the Setup-tab IPC (detect/start Ollama, stream `ollama pull`). Window keeps context isolation on and no Node access. |
| `electron/preload.cjs` | The only bridge into the window: `window.forge.status()`, `startServer()`, `pullModel()`, `installOllama()`, plus streamed setup events. |
| `vite.config.ts` | `FORGE_DESKTOP=1` pins Nitro's `node-server` preset so there is a self-hostable Node build in `.output/`. Web deploys keep Lovable's preset. |
| `src/lib/cad.server.ts` | Calls the local model over the OpenAI-compatible API, strips code fences, and turns connection/model errors into instructions (`start Ollama`, `ollama pull …`). |
| `src/lib/llm-config.ts` | Model + URL settings, persisted in `localStorage`, validated to loopback only, plus the installed-model fallback. |
| `src/components/LocalSetup.tsx` | The Setup terminal: install/start/download with live output. |
| `src/routes/index.tsx` | Chat / code / model / setup tabs, live 3D viewer, STL + JSCAD export. |

The browser still runs the generated code and renders with three.js, so a model change never
requires a server round-trip for rendering.

## Web build

`npm run build` is unchanged and still targets Lovable's default preset; the desktop artifacts
live in `.output/` and `release/` and are git-ignored.
