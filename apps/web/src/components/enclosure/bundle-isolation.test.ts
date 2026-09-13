import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * three.js must reach the browser only through the lazily loaded
 * EnclosureCanvas chunk. This walks the static import graph (dynamic
 * `import()` is not followed; `import type` is erased) from the pages and the
 * root layout, and fails if it reaches three or the 3D modules.
 */

const SRC = path.resolve(import.meta.dirname, "../..");
const STATIC_IMPORT = /(?:^|\n)\s*(import|export)\s+(?!type\s)([^;]*?)\s+from\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;
const THREE_ONLY = ["components/enclosure/EnclosureCanvas.tsx", "components/enclosure/scene.ts"];

function resolveLocal(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function staticGraph(entries: string[]) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = entries.map((entry) => path.join(SRC, entry));
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(STATIC_IMPORT)) {
      const specifier = match[3] ?? match[4]!;
      if (specifier.startsWith(".") || specifier.startsWith("@/")) {
        const resolved = resolveLocal(file, specifier);
        if (resolved && /\.(ts|tsx)$/.test(resolved)) queue.push(resolved);
      } else {
        packages.add(specifier);
      }
    }
  }
  return { files: [...files].map((file) => path.relative(SRC, file)), packages: [...packages] };
}

const PAGES = ["app/layout.tsx", "app/page.tsx", "app/build/[buildId]/page.tsx", "app/(app)/projects/[buildId]/page.tsx"];

describe("three.js stays out of page bundles", () => {
  it.each(PAGES)("%s never statically reaches three or the 3D modules", (entry) => {
    const { files, packages } = staticGraph([entry]);
    expect(packages.filter((name) => name === "three" || name.startsWith("three/"))).toEqual([]);
    for (const file of THREE_ONLY) expect(files).not.toContain(file);
  });

  it("the landing page does reach the preview wrapper, which loads the 3D stage only with next/dynamic and ssr: false", () => {
    expect(staticGraph(["app/page.tsx"]).files).toContain("components/enclosure/EnclosurePreview.tsx");
    const wrapper = readFileSync(path.join(SRC, "components/enclosure/EnclosurePreview.tsx"), "utf8");
    expect(wrapper).toMatch(/dynamic\(\(\) => import\("\.\/EnclosureCanvas"\), \{ ssr: false \}\)/);
  });

  it("the check itself works: the 3D stage does reach three", () => {
    expect(staticGraph(["components/enclosure/EnclosureCanvas.tsx"]).packages).toEqual(expect.arrayContaining(["three"]));
  });

  it("only the 3D modules import three anywhere in src", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && /from\s+["']three(\/[^"']*)?["']/.test(readFileSync(full, "utf8"))) {
          importers.push(path.relative(SRC, full));
        }
      }
    };
    walk(SRC);
    expect(importers.sort()).toEqual(["components/enclosure/scene.ts"]);
  });
});
