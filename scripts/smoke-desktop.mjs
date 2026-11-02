// Smoke test for the desktop shell: launches the real Electron app, talks to the
// renderer over the DevTools protocol, and checks that the preload bridge is
// present and that it can see the local model runtime. Requires `desktop:build`.
import { spawn } from "node:child_process";
import electronPath from "electron";
import { setTimeout as sleep } from "node:timers/promises";

const DEBUG_PORT = Number(process.env["FORGE_SMOKE_PORT"] ?? 9333);
const TIMEOUT_MS = 90_000;

function fail(message) {
  console.error(`FAIL: ${message}`);
  if (output.trim()) console.error(`--- electron output ---\n${output.trim()}`);
  child?.kill();
  process.exit(1);
}

let child = spawn(electronPath, [".", `--remote-debugging-port=${DEBUG_PORT}`], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
child.once("exit", (code) => {
  if (code !== 0 && !closing) fail(`Electron exited with code ${code}\n${output.slice(-2000)}`);
});

const deadline = Date.now() + TIMEOUT_MS;
async function waitForPage() {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && String(t.url).startsWith("http://127.0.0.1"));
      if (page) return page;
    } catch {
      // DevTools endpoint not up yet.
    }
    await sleep(400);
  }
  throw new Error("The app window never appeared.");
}

let closing = false;
try {
  const page = await waitForPage();
  console.log(`window: ${page.url}`);

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  });

  const send = (method, params) => {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
  };

  const evaluate = async (expression) => {
    const evaluated = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const value = evaluated.result?.result?.value;
    if (!value) throw new Error(`Renderer evaluation failed: ${JSON.stringify(evaluated)}`);
    return JSON.parse(value);
  };

  // The renderer target can appear a beat before the preload has run.
  let result = await evaluate(`JSON.stringify({ bridge: typeof window.forge })`);
  for (let attempt = 0; result.bridge !== "object" && attempt < 40; attempt++) {
    await sleep(250);
    result = await evaluate(`JSON.stringify({ bridge: typeof window.forge })`);
  }
  if (result.bridge !== "object") throw new Error(`window.forge is ${result.bridge}, not an object`);

  result = await evaluate(`(async () => JSON.stringify({
    title: document.title,
    hasApp: document.body.innerText.includes("Forge"),
    bridge: typeof window.forge,
    platform: window.forge?.platform ?? null,
    status: (await window.forge.status()) ?? null,
  }))()`);

  if (result.bridge !== "object") throw new Error(`window.forge is ${result.bridge}, not an object`);
  if (!result.hasApp) throw new Error("The app UI did not render in the window");
  if (!result.status) throw new Error("forge.status() returned nothing");
  if (!Array.isArray(result.status.models)) throw new Error("forge.status() did not report models");

  console.log(`ui: "${result.title}" rendered`);
  console.log(`bridge: window.forge on ${result.platform}`);
  console.log(
    `ollama: installed=${result.status.installed} running=${result.status.serverRunning} models=${result.status.models.join(", ") || "(none)"}`,
  );

  const started = await evaluate(`(async () => JSON.stringify(await window.forge.startServer()))()`);
  if (!started.ok) throw new Error(`forge.startServer() failed: ${started.error}`);
  console.log(`startServer: ok (alreadyRunning=${started.alreadyRunning})`);

  // The pull itself downloads gigabytes, so only prove the IPC path and its
  // model-name validation without touching the network.
  const rejected = await evaluate(
    `(async () => JSON.stringify(await window.forge.pullModel("bad name; rm -rf /")))()`,
  );
  if (rejected.ok !== false) throw new Error("forge.pullModel() accepted an invalid model name");
  console.log(`pullModel: invalid names rejected ("${rejected.error}")`);

  console.log("PASS");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  closing = true;
  child.kill();
  process.exit(process.exitCode ?? 0);
}
