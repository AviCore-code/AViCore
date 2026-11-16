// Bundles the VPS Auto Import service into one file:
//   node scripts/vps-autoimport/build.mjs  ->  dist-vps/avicore-autoimport.mjs
// The public Supabase URL / anon key / company slug come from .env.local (the
// same values the web build ships); nothing secret goes into the bundle.

import { build } from "esbuild";
import fs from "node:fs";

function readEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* missing file */ }
  return out;
}

const env = { ...readEnv(".env"), ...readEnv(".env.local") };
const pick = (k) => JSON.stringify(env[k] || "");
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;

await build({
  entryPoints: ["scripts/vps-autoimport/service.mjs"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist-vps/avicore-autoimport.mjs",
  define: {
    "import.meta.env.MODE": JSON.stringify("admin"),
    "import.meta.env.VITE_SUPABASE_URL": pick("VITE_SUPABASE_URL"),
    "import.meta.env.VITE_SUPABASE_ANON_KEY": pick("VITE_SUPABASE_ANON_KEY"),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": pick("VITE_SUPABASE_PUBLISHABLE_KEY"),
    "import.meta.env.VITE_COMPANY_SLUG": pick("VITE_COMPANY_SLUG"),
    "__APP_VERSION__": JSON.stringify(version)
  },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning"
});
console.log("built dist-vps/avicore-autoimport.mjs", version);
