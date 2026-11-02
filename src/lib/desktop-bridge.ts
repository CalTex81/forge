/**
 * Typed access to the small API the Electron shell exposes on `window.forge`.
 *
 * The same UI also runs in a plain browser, where that object is missing, so
 * every caller has to handle `getDesktop()` returning undefined.
 */

export type SetupEvent =
  | { type: "start"; text: string }
  | { type: "line"; stream: "out" | "err"; text: string }
  | { type: "exit"; code: number; text?: string | undefined };

export type SetupStatus = {
  installed: boolean;
  version: string | null;
  serverRunning: boolean;
  models: string[];
  baseUrl: string;
  error: string | null;
};

export type StartServerResult = SetupStatus & {
  ok: boolean;
  alreadyRunning: boolean;
};

export type ForgeDesktop = {
  platform: string;
  status: () => Promise<SetupStatus>;
  startServer: () => Promise<StartServerResult>;
  pullModel: (model: string) => Promise<{ ok: boolean; error?: string | undefined }>;
  cancel: () => Promise<{ ok: boolean }>;
  installOllama: () => Promise<{ ok: boolean }>;
  onEvent: (callback: (event: SetupEvent) => void) => () => void;
};

declare global {
  interface Window {
    forge?: ForgeDesktop;
  }
}

export function getDesktop(): ForgeDesktop | undefined {
  if (typeof window === "undefined") return undefined;
  return window.forge;
}
