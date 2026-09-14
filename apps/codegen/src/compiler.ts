import { z } from "zod";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  FirmwareManifest,
  serializeFirmwareManifest,
} from "@albusforge/schema";

import { COMPILER_IMAGE, CANDIDATE, CHANNELS, renderApp } from "./candidate";
export { editInterval, renderApp } from "./candidate";
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export interface CompileInput {
  build_id: string;
  plan_version: number;
  code_version: number;
  interval_s: number;
}
export interface Compiled {
  manifest: FirmwareManifest;
  manifestBytes: string;
  manifest_digest: string;
  source: string;
  source_sha256: string;
  files: Map<string, Buffer>;
  bundle: Buffer;
  diagnostics: string;
}
async function command(
  args: string[],
  cwd: string,
  timeout = 600_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          [
            "PATH",
            "HOME",
            "LANG",
            "TMPDIR",
            "VIRTUAL_ENV",
            "PYTHONPATH",
            "DOCKER_HOST",
            "DOCKER_CONFIG",
          ].includes(key) ||
          key.startsWith("IDF_") ||
          key.startsWith("ESP_"),
      ),
    );
    const child = spawn(args[0]!, args.slice(1), {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      detached: true,
    });
    let log = "";
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* Process already exited. */
      }
      reject(new Error("Compile deadline exceeded"));
    }, timeout);
    const collect = (data: Buffer) => {
      log = (log + data.toString()).slice(-20000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else reject(new Error(`Compile failed: ${log}`));
    });
  });
}
/** IDF mode runs inside the dedicated pinned compiler job; Docker mode is local isolation. */
export async function compile(
  input: CompileInput,
  templateRoot: string,
  mode: "docker" | "idf" = "docker",
): Promise<Compiled> {
  input = z
    .strictObject({
      build_id: z.uuid(),
      plan_version: z.number().int().positive(),
      code_version: z.number().int().positive(),
      interval_s: z.number().int().min(10).max(86400),
    })
    .parse(input);
  templateRoot = resolve(templateRoot);
  const workRoot =
    process.env.FIRMWARE_WORK_DIR ??
    (mode === "docker" && process.platform === "darwin"
      ? join(homedir(), ".cache/albusforge/fwbuild")
      : tmpdir());
  await mkdir(workRoot, { recursive: true });
  const workspace = await mkdtemp(join(workRoot, "albus-compile-"));
  const source = renderApp(input.interval_s);
  const containerName = `albus-compile-${randomUUID()}`;
  try {
    await cp(templateRoot, workspace, {
      recursive: true,
      filter: (path) =>
        !/(?:^|\/)(?:build|sdkconfig|sdkconfig.old)$/.test(path),
    });
    await writeFile(join(workspace, "main/app.cpp"), source);
    await writeFile(
      join(workspace, "main/include/hsx-build.h"),
      `#pragma once\n#define HSX_BUILD_ID ${JSON.stringify(input.build_id)}\n#define HSX_PLAN_VERSION ${input.plan_version}\n#define HSX_CODE_VERSION ${input.code_version}\n`,
    );
    const args =
      mode === "idf"
        ? ["idf.py", "build"]
        : [
            "docker",
            "run",
            "--rm",
            "--name",
            containerName,
            "--user",
            `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
            "--env",
            "HOME=/tmp",
            "--network",
            "none",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--memory",
            "4g",
            "--cpus",
            "2",
            "--pids-limit",
            "256",
            "-v",
            `${workspace}:/project`,
            "-w",
            "/project",
            COMPILER_IMAGE,
            "sh",
            "-c",
            "idf.py -B /tmp/idf-build build && mkdir -p /project/build/bootloader /project/build/partition_table && cp /tmp/idf-build/bootloader/bootloader.bin /project/build/bootloader/ && cp /tmp/idf-build/partition_table/partition-table.bin /project/build/partition_table/ && cp /tmp/idf-build/albusforge.bin /project/build/",
          ];
    const diagnostics = await command(args, workspace);
    const files = new Map<string, Buffer>();
    for (const [name, path] of [
      ["bootloader.bin", "bootloader/bootloader.bin"],
      ["partition-table.bin", "partition_table/partition-table.bin"],
      ["albusforge.bin", "albusforge.bin"],
    ])
      files.set(name!, await readFile(join(workspace, "build", path!)));
    const manifest = FirmwareManifest.parse({
      v: 1,
      build_id: input.build_id,
      plan_version: input.plan_version,
      code_version: input.code_version,
      profile_id: CANDIDATE,
      runtime: "0.1.0",
      channels: CHANNELS,
      files: [...files].map(([path, bytes]) => ({
        path,
        size: bytes.length,
        sha256: sha256(bytes),
      })),
      flash: { chip: "esp32s3", config_offset: 36864, config_size: 24576 },
    });
    const manifestBytes = serializeFirmwareManifest(manifest);
    const download = join(workspace, "download");
    await mkdir(download);
    for (const [name, bytes] of files)
      await writeFile(join(download, name), bytes);
    await writeFile(join(download, "manifest.json"), manifestBytes);
    await writeFile(join(download, "app.cpp"), source);
    for (const name of ["install.py", "requirements.txt"])
      await cp(join(templateRoot, "../tools", name), join(download, name));
    await command(
      ["python3", join(templateRoot, "../tools/bundle.py"), download],
      workspace,
      30000,
    );
    const bundle = await readFile(join(download, "firmware.zip"));
    return {
      bundle,
      manifest,
      manifestBytes,
      manifest_digest: sha256(manifestBytes),
      source,
      source_sha256: sha256(source),
      files,
      diagnostics,
    };
  } finally {
    if (mode === "docker")
      await command(
        ["docker", "rm", "--force", containerName],
        workspace,
        15000,
      ).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true });
  }
}
