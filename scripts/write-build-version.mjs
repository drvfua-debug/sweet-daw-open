import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(`${root}/package.json`, "utf8"));
const createdAt = new Date().toISOString();
const safeStamp = createdAt.replace(/[-:.TZ]/g, "").slice(0, 14);
const buildId = process.env.NEXT_PUBLIC_SWEET_DAW_BUILD_ID ?? `${packageJson.version}-${safeStamp}`;

const buildInfo = {
  appName: "Sweet DAW",
  version: packageJson.version,
  buildId,
  createdAt,
};

await mkdir(`${root}/src/generated`, { recursive: true });
await mkdir(`${root}/public`, { recursive: true });

await writeFile(
  `${root}/src/generated/buildInfo.ts`,
  `export const SWEET_DAW_BUILD_INFO = ${JSON.stringify(buildInfo, null, 2)} as const;\n`,
  "utf8",
);

await writeFile(`${root}/public/sweet-daw-build.json`, `${JSON.stringify(buildInfo, null, 2)}\n`, "utf8");

try {
  const swPath = `${root}/public/sw.js`;
  const swSource = await readFile(swPath, "utf8");
  const nextSwSource = swSource.replace(
    /const CACHE_NAME = "sweet-daw-cache-[^"]+";/,
    `const CACHE_NAME = "sweet-daw-cache-${buildId}";`,
  );
  await writeFile(swPath, nextSwSource, "utf8");
} catch {
  // The app can build without a service worker in local experiments.
}

console.log(`Sweet DAW build id: ${buildId}`);
