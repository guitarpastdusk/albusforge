import { mkdtemp, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { localArtifacts } from "./artifacts";
it("keeps artifact objects immutable and refuses traversal, symlinks and oversize files", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-test-"));
  const store = localArtifacts(root);
  try {
    await store.put("builds/a/file.bin", Buffer.from("original"));
    await expect(
      store.put("builds/a/file.bin", Buffer.from("changed")),
    ).rejects.toThrow();
    expect((await store.get("builds/a/file.bin")).toString()).toBe("original");
    for (const key of [
      "../secret.bin",
      "/secret.bin",
      "a//secret.bin",
      "a/../../secret.bin",
    ])
      await expect(store.get(key)).rejects.toThrow();
    await symlink(join(root, "builds/a/file.bin"), join(root, "link.bin"));
    await expect(store.get("link.bin")).rejects.toThrow();
    await writeFile(join(root, "large.bin"), Buffer.alloc(6 * 1024 * 1024 + 1));
    await expect(store.get("large.bin")).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
