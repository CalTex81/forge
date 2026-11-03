// Packaging config for the Windows app: package.json's `build` block plus the
// code-signing wiring, which has to be decided at build time from the
// credentials on hand (electron-builder takes either a PFX, a certificate in
// the Windows store, or Azure Trusted Signing — never a mix).
//
// See README → "Code signing" for what each variable means and why an
// unsigned or self-signed installer still makes SmartScreen warn.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const base = pkg.build;
const env = process.env;

const azure = Object.fromEntries(
  Object.entries({
    endpoint: env["FORGE_SIGN_ENDPOINT"],
    codeSigningAccountName: env["FORGE_SIGN_ACCOUNT"],
    certificateProfileName: env["FORGE_SIGN_PROFILE"],
  }).filter(([, v]) => Boolean(v)),
);
const hasAzure = ["endpoint", "codeSigningAccountName", "certificateProfileName"].every((k) => k in azure);

const storeCert = Object.fromEntries(
  Object.entries({
    certificateSubjectName: env["WIN_CERTIFICATE_SUBJECT_NAME"],
    certificateSha1: env["WIN_CERTIFICATE_SHA1"],
    rfc3161TimeStampServer: env["WIN_TIMESTAMP_SERVER"],
  }).filter(([, v]) => Boolean(v)),
);
const hasStoreCert = Boolean(storeCert["certificateSubjectName"] ?? storeCert["certificateSha1"]);

// WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD are read by electron-builder directly.
const hasPfx = Boolean(env["WIN_CSC_LINK"] ?? env["CSC_LINK"]);

let win = { ...base.win };
if (hasAzure) {
  win = {
    ...win,
    azureSignOptions: {
      ...(env["FORGE_SIGN_PUBLISHER"] ? { publisherName: env["FORGE_SIGN_PUBLISHER"] } : {}),
      ...azure,
    },
  };
} else if (hasStoreCert) {
  win = { ...win, signtoolOptions: storeCert };
}

const signed = hasAzure || hasStoreCert || hasPfx;
if (!signed) {
  console.warn(
    "\n[forge] No code-signing credentials found — building an UNSIGNED installer.\n" +
      "[forge] Windows SmartScreen will warn users on first run. See README → Code signing.\n",
  );
  if (env["FORGE_REQUIRE_SIGNING"] === "1") {
    throw new Error("FORGE_REQUIRE_SIGNING=1, but no signing credentials are configured.");
  }
} else {
  console.log(`[forge] Code signing: ${hasAzure ? "Azure Trusted Signing" : hasStoreCert ? "Windows store certificate" : "PFX file"}`);
}

export default { ...base, win };
