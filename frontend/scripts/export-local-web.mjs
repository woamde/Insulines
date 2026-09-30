#!/usr/bin/env node
// Reproducible LOCAL export. The preview .env must never enter this bundle.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = fileURLToPath(new URL("../node_modules/expo/bin/cli", import.meta.url));
const result = spawnSync(process.execPath, [cli, "export", "--platform", "web", "--output-dir", "dist"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    CI: "1",
    EXPO_OFFLINE: "1",
    EXPO_NO_DOTENV: "1",
    EXPO_PUBLIC_BACKEND_URL: "",
    EXPO_PUBLIC_ENABLE_PWA: "1",
  },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);