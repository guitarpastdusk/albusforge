import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GoogleAuth } from "google-auth-library";

export interface ArtifactStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}
const valid = (key: string) => {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.[a-z0-9]+$/.test(key) ||
    key.length > 300 ||
    key.split("/").some((x) => x === ".." || x === "")
  )
    throw new Error("Invalid artifact key");
  return key;
};
/** Local development storage. Production uses immutable objects in a dedicated bucket. */
export function localArtifacts(root: string): ArtifactStore {
  const base = resolve(root);
  return {
    async put(key, bytes) {
      if (bytes.length > 6 * 1024 * 1024)
        throw new Error("Artifact exceeds size limit");
      const target = join(base, valid(key));
      await mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    },
    async get(key) {
      const path = join(base, valid(key));
      const info = await lstat(path);
      if (!info.isFile() || info.size > 6 * 1024 * 1024)
        throw new Error("Invalid artifact file");
      return readFile(path);
    },
  };
}
export function gcsArtifacts(bucket: string): ArtifactStore {
  if (!/^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$/.test(bucket))
    throw new Error("Invalid artifact bucket");
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
  });
  const request = async (url: string, init: RequestInit = {}) => {
    const token = await auth.getAccessToken();
    if (!token) throw new Error("Artifact identity unavailable");
    const response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Artifact storage returned ${response.status}`);
    return response;
  };
  return {
    async put(key, bytes) {
      if (bytes.length > 6 * 1024 * 1024)
        throw new Error("Artifact exceeds size limit");
      await request(
        `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(valid(key))}`,
        {
          method: "POST",
          body: new Uint8Array(bytes),
          headers: { "Content-Type": "application/octet-stream" },
        },
      );
    },
    async get(key) {
      const response = await request(
        `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(valid(key))}?alt=media`,
      );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Artifact body missing");
      let length = 0;
      const chunks: Buffer[] = [];
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 6 * 1024 * 1024)
            throw new Error("Artifact exceeds size limit");
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      return Buffer.concat(chunks, length);
    },
  };
}
