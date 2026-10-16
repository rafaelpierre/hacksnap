import { cp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheFixture = process.env.BROWSER_CACHE_TEST === "1";
const target = path.join(root, cacheFixture ? ".browser-cache-app" : ".browser-app");
const command = process.argv[2];
if (!["build", "start"].includes(command)) throw new Error("Expected build or start");
// An allowlist prevents local .env files, credentials and database configuration
// from entering the fixture application. Ordinary next build never reads this tree.
if (command === "build") {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const entry of [
    "app",
    "lib",
    "certs",
    "proxy.ts",
    "instrumentation-client.ts",
    "next.config.ts",
    "tsconfig.json",
    "next-env.d.ts",
    "package.json",
    "package-lock.json",
  ]) {
    await cp(path.join(root, entry), path.join(target, entry), { recursive: true });
  }
  try {
    await cp(path.join(root, "public"), path.join(target, "public"), { recursive: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await symlink(path.join(root, "node_modules"), path.join(target, "node_modules"), "dir");
  await mkdir(path.join(target, "public/browser-images"), { recursive: true });
  const image = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#25344b"/><circle cx="800" cy="450" r="280" fill="#b86b43"/><path d="M500 450h600M800 150v600" stroke="#fff" stroke-width="24"/></svg>',
  );
  for (const width of [128, 256, 320, 384, 640, 750, 1080, 1600])
    await sharp(image)
      .resize(width)
      .webp({ quality: 75 })
      .toFile(path.join(target, `public/browser-images/${width}.webp`));
  const fixture = await readFile(path.join(root, "e2e/fixtures/data.ts"), "utf8");
  await writeFile(path.join(target, "lib/data.ts"), fixture.replaceAll("../../lib/", "./"));
  if (cacheFixture)
    await writeFile(
      path.join(target, "cache-fixture-state.json"),
      JSON.stringify({ title: "Cache fixture A" }),
    );
  const config = await readFile(path.join(target, "next.config.ts"), "utf8");
  await writeFile(
    path.join(target, "next.config.ts"),
    config.replace(
      "export default config;",
      `config.turbopack = { ...config.turbopack, root: ${JSON.stringify(root)} };\nexport default config;`,
    ),
  );
}
// Keep only process/runtime basics; arbitrary credential names cannot leak into
// a fixture build or its server. The port is passed as an explicit CLI argument.
const inheritedKeys = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "CI", "TZ", "LANG", "LC_ALL"];
const env = Object.fromEntries(
  inheritedKeys.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
);
env.NEXT_TELEMETRY_DISABLED = "1";
// Dummy public configuration only. e2e/browser.ts intercepts every vendor request.
env.NEXT_PUBLIC_POSTHOG_ENABLED = "true";
env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_browser_fixture_not_a_real_project";
env.NEXT_PUBLIC_POSTHOG_HOST = "https://relay.hacksnap.live";
if (cacheFixture) {
  env.HACKSNAP_CACHE_FIXTURE = "true";
  env.HACKSNAP_PUBLICATION_CACHE = "true";
  env.HACKSNAP_STORY_ISR = "true";
  env.HACKSNAP_PUBLICATION_SECRET = "cache-fixture-secret-not-for-production";
}
const child = spawn(
  process.execPath,
  [
    path.join(root, "node_modules/next/dist/bin/next"),
    command,
    ...(command === "start"
      ? ["--hostname", "127.0.0.1", "--port", process.env.BROWSER_PORT ?? "3100"]
      : []),
  ],
  { cwd: target, env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
