// Markdown -> PDF for the check-in documents, rendered the way GitHub renders
// them: marked for the Markdown, mermaid for the fenced diagram. Chromium comes
// from the repo's own Playwright install, so this needs no new dependency.
//
//   node md2pdf.mjs <input.md> <output.pdf>
//
// `<!-- pagebreak -->` in the source becomes a hard page break, which is how
// the earlier check-ins control where sections land.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
// Playwright is a transitive dependency (apps/web's @playwright/test), so it
// isn't resolvable by name from the root. Find it under pnpm's store by glob
// rather than by version, so a version bump doesn't break this script.
const root = process.env.REPO_ROOT ?? process.cwd();
const store = join(root, "node_modules/.pnpm");
const dir = readdirSync(store)
  .filter((name) => /^playwright@/.test(name))
  .sort()
  .at(-1);
if (!dir) {
  console.error(`no playwright under ${store} — run pnpm install, or set REPO_ROOT to the repository root`);
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(join(store, dir, "node_modules/playwright/index.mjs")).href);

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: node md2pdf.mjs <input.md> <output.pdf>");
  process.exit(2);
}

const markdown = readFileSync(input, "utf8");

const page_html = `<!doctype html>
<html><head><meta charset="utf-8">
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js"></script>
<style>
  :root { --ink:#16130f; --muted:#5b5348; --rule:#ddd6cb; --coral:#c4643b; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    font: 9pt/1.42 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    color: var(--ink); margin: 0; padding: 0;
  }
  h1 { font-size: 17pt; margin: 0 0 .3em; letter-spacing: -0.01em; }
  h2 { font-size: 12pt; margin: 1.1em 0 .4em; padding-bottom: .25em; border-bottom: 1px solid var(--rule); }
  h3 { font-size: 10pt; margin: .9em 0 .3em; }
  p { margin: .55em 0; }
  li { margin: .18em 0; }
  p, li { orphans: 3; widows: 3; }
  a { color: var(--coral); text-decoration: none; }
  code { font: 9.2pt/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4f1eb; padding: .1em .35em; border-radius: 3px; }
  pre { background: #f4f1eb; padding: .8em 1em; border-radius: 6px; overflow: hidden; }
  pre code { background: none; padding: 0; font-size: 8.6pt; }
  blockquote {
    margin: .8em 0; padding: .55em .9em; border-left: 3px solid var(--coral);
    background: #faf7f2; font-size: 9.4pt;
  }
  blockquote p { margin: 0; }
  table { border-collapse: collapse; width: 100%; margin: .9em 0; font-size: 8.2pt; page-break-inside: avoid; }
  th, td { border: 1px solid var(--rule); padding: .3em .45em; text-align: left; vertical-align: top; }
  th { background: #f4f1eb; font-weight: 600; }
  td[align="right"], th[align="right"] { text-align: right; }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 1.1em 0; }
  .mermaid { text-align: center; margin: 1.2em 0; page-break-inside: avoid; }
  .pagebreak { page-break-after: always; }
  h2, h3 { page-break-after: avoid; }
</style>
</head><body><article id="doc"></article>
<script>
  const source = ${JSON.stringify(markdown)};
  // The comment marks a deliberate break; turn it into an element the CSS can see.
  const withBreaks = source.replace(/<!--\\s*pagebreak\\s*-->/g, '<div class="pagebreak"></div>');
  marked.setOptions({ gfm: true, breaks: false });
  document.getElementById("doc").innerHTML = marked.parse(withBreaks);
  // marked leaves the fenced mermaid block as <pre><code class="language-mermaid">.
  for (const block of document.querySelectorAll("code.language-mermaid")) {
    const holder = document.createElement("div");
    holder.className = "mermaid";
    holder.textContent = block.textContent;
    block.closest("pre").replaceWith(holder);
  }
  mermaid.initialize({ startOnLoad: false, theme: "neutral", flowchart: { useMaxWidth: true } });
  window.__ready = mermaid.run({ querySelector: ".mermaid" }).then(() => true).catch((e) => String(e));
</script>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const failures = [];
page.on("requestfailed", (r) => failures.push(r.url()));
await page.setContent(page_html, { waitUntil: "networkidle" });

const diagram = await page.evaluate(() => window.__ready ?? "mermaid never started");
if (diagram !== true) {
  console.error(`mermaid did not render: ${diagram}`);
  await browser.close();
  process.exit(1);
}
if (failures.length) {
  console.error(`blocked or failed requests:\n  ${failures.join("\n  ")}`);
  await browser.close();
  process.exit(1);
}

const pdf = await page.pdf({
  format: "Letter",
  printBackground: true,
  margin: { top: "13mm", bottom: "13mm", left: "12mm", right: "12mm" },
});
writeFileSync(output, pdf);
await browser.close();

console.log(`wrote ${output} (${(pdf.length / 1024).toFixed(0)} KB), mermaid rendered: ${diagram === true}`);
