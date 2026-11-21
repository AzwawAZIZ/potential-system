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
const adminPreview = process.argv.includes("--admin-preview");
if (adminPreview) {
  js = js.replace('const KEY = "suivi-miage-v1";', 'const KEY = "suivi-miage-demo-admin-v1";');
  js += '\nif (!s.session) authenticate("admin");\nif (role() === "admin") goto("settings");';
}
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
const output = adminPreview ? "Prototype-administration.html" : "Suivi-MIAGE-UPJV.html";
writeFileSync(output, html);
console.log(`Version autonome générée : ${output} · ${Math.round(Buffer.byteLength(html) / 1024)} Ko`);
