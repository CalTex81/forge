# Forge — text → CAD, on your own machine

Describe a part in words. A language model **running on your computer** writes parametric
[JSCAD](https://openjscad.xyz) code, the app executes it in the browser context and renders an
interactive 3D model you can refine, edit and export as STL or 3MF.

Nothing is sent to the cloud: the site is packaged as a Windows app that serves itself from a
local port, and the model server is on `localhost`.

## Install

Download `Forge Setup 1.1.1.exe` from the latest GitHub release and run it. The installer is
per-user (no admin required) and lets you pick the install directory. It is signed only when the
build machine has signing credentials (see [Code signing](#code-signing)); an unsigned build makes
Windows SmartScreen ask for confirmation on first run.

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

That produces `release/Forge Setup 1.1.1.exe` — a normal NSIS installer. Requirements are bundled.
The build reads signing credentials from the environment; with none present it prints a warning and
produces an unsigned installer that SmartScreen will challenge.

## Code signing

An unsigned installer triggers "Windows protected your PC", and a self-signed certificate does not
change that: SmartScreen only trusts certificates chained to a public CA it has seen before. Signing
is wired into `electron-builder.config.mjs`, which signs with whatever credentials are in the
environment and otherwise builds unsigned. Pick one of three setups:

**PFX file** (from any standard code-signing certificate):

```bash
WIN_CSC_LINK=path/to/cert.pfx       # or a base64 blob, e.g. in CI secrets
WIN_CSC_KEY_PASSWORD=…
npm run desktop:dist
```

**Certificate in the Windows certificate store** (printed as a `certificateSubjectName`):

```bash
WIN_CERTIFICATE_SUBJECT_NAME="Your Name"   # or WIN_CERTIFICATE_SHA1=<thumbprint>
WIN_TIMESTAMP_SERVER=http://timestamp.digicert.com   # optional; this is the default
npm run desktop:dist
```

**Azure Trusted Signing** (cloud signing, no USB token — the only option that works unattended
because CA/B rules forbid shipping a code-signing private key as a file):

```bash
FORGE_SIGN_ENDPOINT=https://eus.codesigning.azure.net
FORGE_SIGN_ACCOUNT=your-signing-account
FORGE_SIGN_PROFILE=your-certificate-profile
FORGE_SIGN_PUBLISHER="Your Name"   # optional but recommended
```

Set `FORGE_REQUIRE_SIGNING=1` in a release build to turn a missing/expired credential into a hard
error instead of a silent unsigned artifact.

Expectations, so nobody is surprised later:

- **Standard (OV) certificates** build SmartScreen reputation over weeks of downloads. New OV-signed
  builds still warn until the file earns reputation.
- **EV certificates** (hardware token or cloud HSM) remove the warning immediately, because they
  inherit Microsoft's existing trust for the publisher.
- A certificate issued under one publisher name only helps builds whose metadata matches that name.
- Secrets stay out of the repo: `WIN_CSC_LINK` may be a path or base64, and CI supplies it as a
  secret. `release/*.pfx` is never written by the build.

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
