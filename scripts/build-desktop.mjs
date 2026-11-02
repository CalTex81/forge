// Builds the app for the desktop shell: the same TanStack Start app, but
// compiled for a local Node server (.output/) instead of a cloud preset.
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["vite", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, FORGE_DESKTOP: "1" },
});

if (result.status !== 0) process.exit(result.status ?? 1);
