// CommonJS on purpose: Electron's ESM loader does not work for app code inside
// app.asar, so the main process entry stays CJS. The server bundle is loaded with
// a dynamic import() from resources/, which is a plain file on disk.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const { appendFileSync, existsSync } = require("node:fs");
const { createServer } = require("node:net");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

/** Set while developing against `npm run dev`; otherwise the bundled server is used. */
const devUrl = process.env["FORGE_DEV_URL"] && process.env["FORGE_DEV_URL"].trim();
/** Lets a launcher redirect the startup log; defaults to the per-user data folder. */
const logFileOverride = process.env["FORGE_LOG_FILE"] && process.env["FORGE_LOG_FILE"].trim();

let mainWindow = null;
let appUrl = "";
/** The `ollama pull` process, if one is running. */
let setupChild = null;

const OLLAMA_PAGE = "https://ollama.com/download/windows";
const OLLAMA_URL = "http://127.0.0.1:11434";

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts
    .map((part) => (part instanceof Error ? (part.stack ?? part.message) : String(part)))
    .join(" ")}`;
  console.log(line);
  try {
    appendFileSync(logFileOverride || join(app.getPath("userData"), "forge.log"), `${line}\n`);
  } catch {
    // Logging must never take the app down.
  }
}

process.on("uncaughtException", (error) => log("[uncaughtException]", error));
process.on("unhandledRejection", (error) => log("[unhandledRejection]", error));

log(`[boot] main loaded packaged=${app.isPackaged} userData=${app.getPath("userData")}`);

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = "timed out";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The app server at ${url} never answered (${last}).`);
}

/**
 * Ollama ships as a normal .exe inside the user's local programs on Windows;
 * other installs (and Linux/macOS) are found on PATH.
 */
function ollamaBinary() {
  const candidates = [];
  if (process.env["LOCALAPPDATA"])
    candidates.push(join(process.env["LOCALAPPDATA"], "Programs", "Ollama", "ollama.exe"));
  if (process.env["ProgramFiles"])
    candidates.push(join(process.env["ProgramFiles"], "Ollama", "ollama.exe"));
  if (process.env["ProgramW6432"])
    candidates.push(join(process.env["ProgramW6432"], "Ollama", "ollama.exe"));
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return "ollama";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs a short command and resolves with its output; never rejects. */
function runCommand(file, args, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timer = null;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), ...result });
    };

    let child;
    try {
      child = spawn(file, args, { windowsHide: true });
    } catch (error) {
      finish({ ok: false, error: String(error) });
      return;
    }

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already exited.
      }
      finish({ ok: false, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.once("error", (error) => finish({ ok: false, error: error.message }));
    child.once("close", (code) => finish({ ok: code === 0, code }));
  });
}

async function probeOllama(baseUrl = OLLAMA_URL) {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { serverRunning: false, models: [], error: `The model server answered ${res.status}.` };
    const data = await res.json();
    const models = (data.models ?? [])
      .map((entry) => entry.name ?? entry.model ?? "")
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    return { serverRunning: true, models, error: null };
  } catch (error) {
    return { serverRunning: false, models: [], error: error.message ?? String(error) };
  }
}

async function setupStatus() {
  const [version, probe] = await Promise.all([
    runCommand(ollamaBinary(), ["--version"], 8000),
    probeOllama(),
  ]);
  const versionText = `${version.stdout} ${version.stderr}`.trim();
  return {
    installed: version.ok,
    version: versionText || null,
    serverRunning: probe.serverRunning,
    models: probe.models,
    baseUrl: OLLAMA_URL,
    error: probe.error ?? version.error ?? null,
  };
}

async function startOllamaServer() {
  const probe = await probeOllama();
  if (probe.serverRunning) return { ok: true, alreadyRunning: true, ...(await setupStatus()) };

  const version = await runCommand(ollamaBinary(), ["--version"], 8000);
  if (!version.ok) {
    return {
      ok: false,
      alreadyRunning: false,
      ...(await setupStatus()),
      error: "Ollama isn't installed yet — install it first, then try again.",
    };
  }

  try {
    const child = spawn(ollamaBinary(), ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
  } catch (error) {
    return {
      ok: false,
      alreadyRunning: false,
      ...(await setupStatus()),
      error: `Could not start Ollama: ${error.message ?? String(error)}`,
    };
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await sleep(500);
    const next = await probeOllama();
    if (next.serverRunning) return { ok: true, alreadyRunning: false, ...(await setupStatus()) };
  }
  return {
    ok: false,
    alreadyRunning: false,
    ...(await setupStatus()),
    error: "Ollama didn't answer on 127.0.0.1:11434 within 30 seconds. Try again in a moment.",
  };
}

function sendSetupEvent(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("forge:setup-event", payload);
}

function sendOutput(stream, chunk) {
  for (const line of String(chunk).split(/\r\n|\r|\n/)) {
    if (line.trim()) sendSetupEvent({ type: "line", stream, text: line });
  }
}

function cancelSetupChild() {
  if (!setupChild) return;
  const child = setupChild;
  setupChild = null;
  try {
    child.kill();
  } catch {
    // Already exited.
  }
}

function startModelPull(model) {
  if (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/.test(model)) {
    return { ok: false, error: "That model name doesn't look right. Try qwen2.5-coder:7b." };
  }

  cancelSetupChild();
  sendSetupEvent({ type: "start", text: `ollama pull ${model}` });

  let child;
  try {
    child = spawn(ollamaBinary(), ["pull", model], { windowsHide: true });
  } catch (error) {
    sendSetupEvent({ type: "exit", code: -1, text: String(error) });
    return { ok: false, error: String(error) };
  }

  setupChild = child;
  child.stdout?.on("data", (chunk) => sendOutput("out", chunk));
  child.stderr?.on("data", (chunk) => sendOutput("err", chunk));
  child.once("error", (error) => {
    setupChild = null;
    sendSetupEvent({ type: "line", stream: "err", text: error.message ?? String(error) });
    sendSetupEvent({ type: "exit", code: -1 });
  });
  child.once("close", (code) => {
    setupChild = null;
    sendSetupEvent({ type: "exit", code: code ?? -1 });
  });
  return { ok: true };
}

/** The Setup tab: detect, start and install models, all from inside the app. */
function registerSetupIpc() {
  const allowed = (event) => {
    try {
      const url = event.senderFrame?.url ?? "";
      return !appUrl || url.startsWith(appUrl);
    } catch {
      return false;
    }
  };

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!allowed(event)) throw new Error("Blocked: unexpected IPC sender.");
      return fn(...args);
    });
  };

  handle("forge:status", () => setupStatus());
  handle("forge:start-server", () => startOllamaServer());
  handle("forge:pull-model", (model) => startModelPull(model));
  handle("forge:cancel", () => {
    cancelSetupChild();
    return { ok: true };
  });
  handle("forge:open-ollama", async () => {
    await shell.openExternal(OLLAMA_PAGE);
    return { ok: true };
  });
}

/**
 * Boots the TanStack Start server that was built into .output/ and returns its
 * URL. Serving over http://127.0.0.1 (instead of file://) is what makes server
 * functions, streaming and the JSCAD bundle work exactly as they do on the web.
 */
async function startAppServer() {
  if (devUrl) {
    await waitForServer(devUrl, 120_000);
    return devUrl;
  }

  const entry = app.isPackaged
    ? join(process.resourcesPath, "output", "server", "index.mjs")
    : join(__dirname, "..", ".output", "server", "index.mjs");

  if (!existsSync(entry)) {
    throw new Error(`The app server build is missing at ${entry}.\n\nRun "npm run desktop:build" first.`);
  }

  const port = await freePort();
  process.env["PORT"] = String(port);
  process.env["NITRO_PORT"] = String(port);
  process.env["HOST"] = "127.0.0.1";
  process.env["NITRO_HOST"] = "127.0.0.1";

  log(`[server] loading ${entry} on port ${port}`);
  // The Nitro node build starts listening as soon as it is imported.
  await import(pathToFileURL(entry).href);

  const url = `http://127.0.0.1:${port}`;
  await waitForServer(url, 120_000);
  return url;
}

function buildMenu() {
  return Menu.buildFromTemplate([
    { label: "File", submenu: [{ role: "quit" }] },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ]);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#0f1115",
    show: false,
    title: "Forge",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  log(`[window] preload=${join(__dirname, "preload.cjs")}`);
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    log(`[window] preload failed at ${preloadPath}`, error);
  });
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    log(`[window] failed to load ${appUrl}: ${code} ${description}`);
  });

  // Keep the window on the app; anything else opens in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) void shell.openExternal(url);
    }
  });

  void mainWindow.loadURL(appUrl);
}

async function start() {
  app.setAppUserModelId("com.forge.cad");
  Menu.setApplicationMenu(buildMenu());
  registerSetupIpc();
  log(`[start] packaged=${app.isPackaged} electron=${process.versions.electron} node=${process.versions.node} resources=${process.resourcesPath}`);

  try {
    appUrl = await startAppServer();
  } catch (error) {
    log("[start] server failed", error);
    dialog.showErrorBox("Forge could not start", error instanceof Error ? error.message : String(error));
    app.quit();
    return;
  }

  log(`[start] app server ready at ${appUrl}`);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app
    .whenReady()
    .then(start)
    .catch((error) => {
      log("[start] fatal", error);
      dialog.showErrorBox("Forge could not start", error instanceof Error ? error.message : String(error));
      app.quit();
    });

  app.on("before-quit", () => cancelSetupChild());
  app.on("window-all-closed", () => app.quit());
}
