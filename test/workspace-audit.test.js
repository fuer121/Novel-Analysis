import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { auditWorkspace, parseWorktreeList } from "../scripts/workspace-audit.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("parses branch and detached worktrees", () => {
  assert.deepEqual(parseWorktreeList([
    "worktree /tmp/main",
    "HEAD 0123456789abcdef0123456789abcdef01234567",
    "branch refs/heads/main",
    "",
    "worktree /tmp/review",
    "HEAD 123456789abcdef0123456789abcdef012345678",
    "detached",
  ].join("\n")), [
    {
      path: "/tmp/main",
      head: "0123456789abcdef0123456789abcdef01234567",
      branch: "main",
      detached: false,
    },
    {
      path: "/tmp/review",
      head: "123456789abcdef0123456789abcdef012345678",
      branch: null,
      detached: true,
    },
  ]);
});

test("audits worktrees without changing repository state", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-audit-"));
  const linked = `${root}-linked`;
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(linked, { recursive: true, force: true }));

  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.name", "Workspace Audit Test"]);
  git(root, ["config", "user.email", "workspace-audit@example.com"]);
  await fs.writeFile(path.join(root, "README.md"), "fixture\n");
  git(root, ["add", "README.md"]);
  git(root, ["commit", "-m", "initial fixture"]);
  git(root, ["worktree", "add", linked, "-b", "feature"]);
  await fs.writeFile(path.join(linked, "dirty.txt"), "dirty\n");

  const before = git(root, ["status", "--porcelain"]);
  const audit = await auditWorkspace(linked);
  const after = git(root, ["status", "--porcelain"]);

  assert.equal(after, before);
  assert.equal(audit.root, await fs.realpath(root));
  assert.equal(audit.worktrees.length, 2);
  assert.equal(audit.worktrees.find(({ branch }) => branch === "main").clean, true);
  assert.equal(audit.worktrees.find(({ branch }) => branch === "feature").clean, false);
  assert.equal(audit.branches.find(({ name }) => name === "feature").checkedOut, true);
  assert.equal(audit.localWorktreeDirectoryKb, 0);
});
