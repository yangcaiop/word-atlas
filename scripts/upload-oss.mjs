import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadEnv } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...loadEnv("pages", root, "ATLAS_"), ...process.env };
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dry-run")) {
  throw new Error(
    "用法：npm run upload:oss -- [--dry-run]。Bucket 与前缀可通过 ATLAS_OSS_DESTINATION 配置。",
  );
}
const destination =
  env.ATLAS_OSS_DESTINATION || "oss://word-atlas-oss/word-atlas/";
if (
  !/^oss:\/\/[a-z0-9][a-z0-9-]{1,61}[a-z0-9]\/(?:[a-zA-Z0-9_-]+\/)+$/.test(
    destination,
  )
) {
  throw new Error(
    "上传目标必须包含专用前缀并以 / 结尾，例如 oss://word-atlas-oss/word-atlas/。",
  );
}
const endpoint = new URL(
  env.ATLAS_OSS_UPLOAD_ENDPOINT || "https://oss-cn-shenzhen.aliyuncs.com",
);
if (
  endpoint.protocol !== "https:" ||
  endpoint.username ||
  endpoint.password ||
  endpoint.pathname !== "/" ||
  endpoint.search ||
  endpoint.hash
) {
  throw new Error(
    "上传 Endpoint 必须是 HTTPS 地址，例如 https://oss-cn-shenzhen-internal.aliyuncs.com。",
  );
}

async function inspect(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let count = 0;
  let bytes = 0;
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`媒体目录不能包含符号链接：${absolute}`);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      const nested = await inspect(absolute, extension);
      count += nested.count;
      bytes += nested.bytes;
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      count++;
      bytes += (await fs.stat(absolute)).size;
    }
  }
  return { count, bytes };
}

const commands = [];
let count = 0;
let bytes = 0;
for (const [directory, extension, contentType] of [
  ["img", ".webp", "image/webp"],
  ["thumb", ".webp", "image/webp"],
  ["audio", ".mp3", "audio/mpeg"],
]) {
  const source = path.join(root, "public/atlas", directory);
  const stats = await inspect(source, extension);
  count += stats.count;
  bytes += stats.bytes;
  commands.push([
    "cp",
    `${source}${path.sep}`,
    `${destination}atlas/${directory}/`,
    "--recursive",
    "--update",
    "--include",
    `*${extension}`,
    "--acl",
    "public-read",
    "--content-type",
    contentType,
    "--endpoint",
    endpoint.origin,
    "--region",
    "cn-shenzhen",
  ]);
}
commands.push([
  "cp",
  path.join(root, "CONTENT_LICENSE.md"),
  `${destination}CONTENT_LICENSE.md`,
  "--update",
  "--acl",
  "public-read",
  "--content-type",
  "text/plain; charset=utf-8",
  "--endpoint",
  endpoint.origin,
  "--region",
  "cn-shenzhen",
]);
console.log(
  JSON.stringify(
    {
      destination,
      endpoint: endpoint.origin,
      mediaFiles: count,
      megabytes: +(bytes / 1024 / 1024).toFixed(2),
      acl: "public-read",
      dryRun: args.includes("--dry-run"),
    },
    null,
    2,
  ),
);
console.log(
  "仅上传公开词库图片、缩略图、音频与内容许可；使用 ossutil 已配置的身份。",
);
if (args.includes("--dry-run")) {
  for (const command of commands)
    console.log(
      ["ossutil", ...command].map((part) => JSON.stringify(part)).join(" "),
    );
} else {
  for (const command of commands) {
    const result = spawnSync("ossutil", command, {
      stdio: "inherit",
      cwd: root,
    });
    if (result.error)
      throw new Error(
        "无法启动 ossutil，请先安装 ossutil 2 并运行 ossutil config 配置上传身份。",
        { cause: result.error },
      );
    if (result.status !== 0)
      throw new Error(
        "OSS 上传失败。请检查 ossutil 的凭证、对象写入权限、公共访问限制及 Endpoint；完成后可重新运行以增量上传。",
      );
  }
}
