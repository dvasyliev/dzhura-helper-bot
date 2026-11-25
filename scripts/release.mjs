#!/usr/bin/env node
// Releases the commits since the last vX.Y.Z tag: raises the version from the Conventional Commits
// (breaking: major, or minor below 1.0; feat: minor; anything else: patch) in package.json,
// package-lock.json, pyproject.toml and uv.lock, adds the commits to CHANGELOG.md, commits only those
// files and tags the commit. Prints "X -> Y" when it released, nothing when there was nothing to release.
// Usage: node scripts/release.mjs   (the pre-push git hook runs it)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const read = (file) => readFileSync(file, "utf8");

const current = JSON.parse(read("package.json")).version;
const tag = `v${current}`;
if (!git("tag", "--list", tag))
  throw new Error(
    `no tag ${tag} to count commits from; tag the commit that set ${current}`,
  );

// Commits since the last release: subject, type and whether it breaks.
const hashes = git("log", "--format=%h", `${tag}..HEAD`)
  .split("\n")
  .filter(Boolean);
if (!hashes.length) process.exit(0);
const commits = hashes.map((hash) => {
  const subject = git("log", "-1", "--format=%s", hash);
  const breaking =
    /^[a-z]+(\([^)]*\))?!:/.test(subject) ||
    /^BREAKING[ -]CHANGE:/m.test(git("log", "-1", "--format=%b", hash));
  const type = subject.match(/^([a-z]+)/)?.[1];
  const text = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, "");
  return { hash, type, breaking, text };
});

const [major, minor, patch] = current.split(".").map(Number);
const breaking = commits.some((c) => c.breaking);
const next =
  breaking && major > 0
    ? `${major + 1}.0.0`
    : breaking || commits.some((c) => c.type === "feat")
      ? `${major}.${minor + 1}.0`
      : `${major}.${minor}.${patch + 1}`;

// The version in each file; only that line changes, so the files keep their layout.
const replace = (file, from, to) => {
  const text = read(file);
  if (!text.includes(from)) throw new Error(`${file}: no ${from}`);
  writeFileSync(file, text.replace(from, to));
};
replace("package.json", `"version": "${current}"`, `"version": "${next}"`);
const lock = JSON.parse(read("package-lock.json"));
lock.version = next;
lock.packages[""].version = next;
writeFileSync("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
const name = JSON.parse(read("package.json")).name;
const pyVersion = read("pyproject.toml").match(/^version = "([^"]+)"/m)?.[1];
replace("pyproject.toml", `version = "${pyVersion}"`, `version = "${next}"`);
replace(
  "uv.lock",
  `name = "${name}"\nversion = "${pyVersion}"`,
  `name = "${name}"\nversion = "${next}"`,
);

// CHANGELOG.md: the new release on top.
const group = (title, list) =>
  list.length
    ? [`### ${title}`, "", ...list.map((c) => `- ${c.text} (${c.hash})`), ""]
    : [];
const section = [
  `## ${next} (${new Date().toISOString().slice(0, 10)})`,
  "",
  ...group(
    "Breaking",
    commits.filter((c) => c.breaking),
  ),
  ...group(
    "Features",
    commits.filter((c) => !c.breaking && c.type === "feat"),
  ),
  ...group(
    "Fixes",
    commits.filter((c) => !c.breaking && c.type === "fix"),
  ),
  ...group(
    "Other",
    commits.filter((c) => !c.breaking && c.type !== "feat" && c.type !== "fix"),
  ),
].join("\n");
const old = read("CHANGELOG.md").replace(/^# Changelog\n\n/, "");
writeFileSync("CHANGELOG.md", `# Changelog\n\n${section}\n${old}`);

// Commit only these files, so nobody else's staged or unstaged work comes along.
const files = [
  "package.json",
  "package-lock.json",
  "pyproject.toml",
  "uv.lock",
  "CHANGELOG.md",
];
git("add", ...files);
git("commit", "-m", `chore(release): v${next}`, "--", ...files);
git("tag", "-a", `v${next}`, "-m", `v${next}`);
console.log(`${current} -> ${next}`);
