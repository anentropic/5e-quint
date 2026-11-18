#!/usr/bin/env node
// Fork only (anentropic/5e-quint): build upstream's SDK package as @anentropic/dnd-sdk and
// attach the tarball to a GitHub release. Run by .github/workflows/fork-release-sdk.yml.
// See FORK.md.
//
// The version is upstream's SDK version plus a fork counter, for example 0.2.0-anentropic.1.
// The counter starts at 1 for each upstream version and goes up by one per fork release.
//
// Steps:
//   1. Rename the SDK manifest input (name, version, repository) and point upstream's
//      packed-consumer check at the new name, in the working tree only.
//   2. Run upstream's `pnpm check:distribution` in two halves: its release-script self-tests
//      before the rename (they expect upstream's manifest), then its build, pack and
//      isolated-consumer check after it, so the bytes released are the bytes checked.
//   3. Create the tag sdk-v<version> on HEAD and a release with the tarball attached.
//
// Env: DRY_RUN=true stops before the release. GITHUB_REPOSITORY (owner/name) for the
// release links. Needs: git, pnpm, gh with GH_TOKEN (contents write) unless DRY_RUN.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORK_NAME = "@anentropic/dnd-sdk";
const UPSTREAM_NAME = "@dearlordylord/dnd-sdk";
const PRERELEASE = "anentropic";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repository = process.env.GITHUB_REPOSITORY ?? "anentropic/5e-quint";
const dryRun = process.env.DRY_RUN === "true";

const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, encoding: "utf8", ...options });
const log = (message) => process.stderr.write(`${message}\n`);

const manifestPath = resolve(root, "distribution/sdk/package.json");
const consumerPath = resolve(root, "scripts/distribution/consumer.ts.txt");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.name !== UPSTREAM_NAME) {
  throw new Error(
    `Expected ${UPSTREAM_NAME} in ${manifestPath}, found ${manifest.name}`,
  );
}
const base = manifest.version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(base)) {
  throw new Error(`Unexpected upstream SDK version ${base}`);
}

// Next fork counter for this upstream version, from the existing tags.
const tagPrefix = `sdk-v${base}-${PRERELEASE}.`;
const counters = run("git", ["tag", "--list", `${tagPrefix}*`])
  .split("\n")
  .map((tag) => tag.trim().slice(tagPrefix.length))
  .filter((rest) => /^\d+$/.test(rest))
  .map(Number);
const version = `${base}-${PRERELEASE}.${Math.max(0, ...counters) + 1}`;
const tag = `sdk-v${version}`;
const head = run("git", ["rev-parse", "HEAD"]).trim();
const upstreamHead = (() => {
  try {
    return run("git", ["rev-parse", "--short=9", "origin/master"]).trim();
  } catch {
    return "unknown";
  }
})();
log(
  `Releasing ${FORK_NAME}@${version} from ${head} (upstream master ${upstreamHead})`,
);

// 2a. Upstream's release-script self-tests, on the unchanged tree.
run("pnpm", ["check:distribution:self-test"], { stdio: "inherit" });

// 1. Rename, in the working tree only.
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      ...manifest,
      name: FORK_NAME,
      version,
      repository: {
        ...manifest.repository,
        url: `git+https://github.com/${repository}.git`,
      },
    },
    null,
    2,
  )}\n`,
);
const consumer = readFileSync(consumerPath, "utf8");
if (!consumer.includes(`"${UPSTREAM_NAME}/`)) {
  throw new Error(`${consumerPath} no longer imports ${UPSTREAM_NAME}`);
}
writeFileSync(
  consumerPath,
  consumer.replaceAll(`"${UPSTREAM_NAME}/`, `"${FORK_NAME}/`),
);

try {
  // 2b. Upstream's build, pack and packed-consumer check (the rest of check:distribution),
  // under the same shared verification lock.
  run(
    "sh",
    [
      "-c",
      ". scripts/resource-lock-owner.sh && with_resource_lock_owner " +
        "scripts/with-broad-workspace-lock.sh node scripts/distribution/qualify.mjs",
    ],
    { stdio: "inherit" },
  );
} finally {
  run("git", ["checkout", "--", manifestPath, consumerPath]);
}

const archiveName = `${FORK_NAME.slice(1).replace("/", "-")}-${version}.tgz`;
const archive = resolve(root, "dist/npm", archiveName);
if (!existsSync(archive))
  throw new Error(`the distribution check did not produce ${archive}`);
const integrity = `sha512-${createHash("sha512").update(readFileSync(archive)).digest("base64")}`;
const url = `https://github.com/${repository}/releases/download/${tag}/${archiveName}`;
log(`Built ${archive}\n  ${integrity}`);

const notes = `${FORK_NAME}@${version}: upstream's \`${UPSTREAM_NAME}\` ${base} built from this \
fork's \`main\` at ${head} (upstream \`master\` ${upstreamHead}).

Install it under upstream's name, so imports stay \`${UPSTREAM_NAME}/...\`:

\`\`\`json
"${UPSTREAM_NAME}": "${url}"
\`\`\`

Integrity: \`${integrity}\`
`;

if (dryRun) {
  log(`DRY_RUN: would create release ${tag} with ${archiveName}\n\n${notes}`);
  process.exit(0);
}

// 3. Tag and release.
run(
  "gh",
  [
    "release",
    "create",
    tag,
    archive,
    "--target",
    head,
    "--title",
    `${FORK_NAME} ${version}`,
    "--notes",
    notes,
  ],
  { stdio: ["ignore", "inherit", "inherit"] },
);
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary)
  writeFileSync(summary, `## ${FORK_NAME} ${version}\n\n${notes}`, {
    flag: "a",
  });
log(`Released ${url}`);
