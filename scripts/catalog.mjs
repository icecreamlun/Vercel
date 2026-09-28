import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import "./env.mjs";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = JSON.parse(await readFile("fixtures/revisions.json", "utf8"));
const verifyRemote = process.argv.includes("--verify-remote");
async function github(path) {
  const response = await fetch(
    `https://api.github.com/repos/${source.repo}/git/${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub source verification returned HTTP ${response.status}`,
    );
  return response.json();
}
await mkdir("dist/bundles", { recursive: true });
const bundle = await readFile("dist/runner.mjs");
await writeFile(`dist/bundles/${hash(bundle)}.mjs`, bundle);
const versions = [];
for (const revision of source.versions) {
  const bytes = await readFile(`fixtures/prompts/${revision.id}.md`);
  const gitBlob = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  if (
    hash(bytes) !== revision.hash ||
    gitBlob !== revision.blob ||
    bytes.length > 8192
  )
    throw new Error(`Cached prompt integrity mismatch: ${revision.id}`);
  const prompt = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (verifyRemote) {
    const tree = await github(`trees/${revision.sha}?recursive=1`);
    const file = tree.tree.find((entry) => entry.path === source.path);
    if (
      tree.truncated ||
      file?.mode !== "100644" ||
      file?.type !== "blob" ||
      file?.sha !== revision.blob
    )
      throw new Error(
        `Source is not the expected regular file: ${revision.id}`,
      );
    const blob = await github(`blobs/${file.sha}`);
    if (
      blob.encoding !== "base64" ||
      !Buffer.from(blob.content, "base64").equals(bytes)
    )
      throw new Error(`Remote artifact differs: ${revision.id}`);
  }
  versions.push({ ...revision, repo: source.repo, path: source.path, prompt });
}
await writeFile(
  "dist/catalog.json",
  JSON.stringify(
    {
      bundleHash: hash(bundle),
      model: "claude-haiku-4-5-20251001",
      image: source.image,
      versions,
    },
    null,
    2,
  ),
);
console.log(
  `Archived runner and verified ${versions.length} immutable ${verifyRemote ? "GitHub" : "cached"} prompt revisions.`,
);
