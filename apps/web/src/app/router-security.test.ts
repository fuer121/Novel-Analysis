import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "../..");

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : [target];
  }));
  return files.flat().filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith("router-security.test.ts"));
}

describe("internal router security boundary", () => {
  it("has no production react-router dependency", async () => {
    const manifest = JSON.parse(await readFile(path.join(webRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };

    expect(manifest.dependencies).not.toHaveProperty("react-router");
    expect(manifest.dependencies).not.toHaveProperty("react-router-dom");
  });

  it("has no react-router source import", async () => {
    const imports = await Promise.all((await sourceFiles(path.join(webRoot, "src"))).map(async (file) => (
      /from ["']react-router(?:-dom)?["']/.test(await readFile(file, "utf8"))
        ? path.relative(webRoot, file)
        : null
    )));

    expect(imports.filter((file) => file !== null)).toEqual([]);
  });
});
