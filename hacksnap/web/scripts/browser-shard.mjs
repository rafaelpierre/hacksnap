import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function selectTests(list, shard) {
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error("Expected shard current/total");
  const [current, total] = shard.split("/").map(Number);
  if (current > total) throw new Error("Shard index exceeds shard count");
  const tests = list
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[chromium] › "));
  if (!tests.length) throw new Error("No Chromium tests discovered");
  if (new Set(tests).size !== tests.length) throw new Error("Duplicate Chromium tests discovered");
  // Interleave files so expensive layout/accessibility cases reach every runner.
  const selected = tests.filter((_, index) => index % total === current - 1);
  if (!selected.length) throw new Error("Shard has no tests; reduce the shard count");
  return { selected, total: tests.length };
}

function main() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const cli = path.join(root, "node_modules/playwright/cli.js");
  const listed = spawnSync(
    process.execPath,
    [cli, "test", "--project=chromium", "--list", "--reporter=list"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "inherit"],
      maxBuffer: 10_000_000,
    },
  );
  if (listed.error) throw listed.error;
  if (listed.status !== 0) {
    process.stderr.write(listed.stdout ?? "");
    process.exitCode = listed.status ?? 1;
    return;
  }
  const { selected, total } = selectTests(listed.stdout, process.argv[2]);
  console.log(`Chromium shard ${process.argv[2]}: ${selected.length}/${total} tests`);
  const directory = mkdtempSync(path.join(tmpdir(), "hacksnap-browser-shard-"));
  try {
    const testList = path.join(directory, "tests.txt");
    writeFileSync(testList, selected.join("\n") + "\n");
    const result = spawnSync(
      process.execPath,
      [cli, "test", "--project=chromium", `--test-list=${testList}`, ...process.argv.slice(3)],
      { cwd: root, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
