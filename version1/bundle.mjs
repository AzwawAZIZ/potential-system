import { readFileSync, writeFileSync } from "node:fs";
const files = ["seed.js", "domain.js", "storage.js", "ui.js", "app.js"];
let js = files
  .map(
    (file) =>
      `\n// ── ${file} ──\n` +
      readFileSync(file, "utf8")
        .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
        .replace(/\bexport (?=(?:const|let|function|class)\b)/g, ""),
  )
  .join("\n");
js = js.replace(/<\/script/gi, "<\\/script");
const css = readFileSync("styles.css", "utf8");
const html = readFileSync("index.html", "utf8")
  .replace(
    /<link rel="stylesheet" href="styles\.css"\s*\/?>/,
    () => `<style>${css}</style>`,
  )
  .replace(
    /<script\s+type="module"\s+src="app\.js"\s*><\/script>/,
    () => `<script>\n'use strict';\n(()=>{\n${js}\n})();\n</script>`,
  );
writeFileSync("Suivi-MIAGE-UPJV.html", html);
console.log(
  "Version autonome générée : Suivi-MIAGE-UPJV.html · " +
    Math.round(Buffer.byteLength(html) / 1024) +
    " Ko",
);
