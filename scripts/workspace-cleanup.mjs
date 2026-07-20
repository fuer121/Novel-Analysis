import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditWorkspace } from "./workspace-audit.mjs";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function hasMergedPullRequest(root, branch) {
  try {
    const output = execFileSync(
      "gh",
      ["pr", "list", "--state", "merged", "--head", branch, "--json", "number", "--limit", "1"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(output).length > 0;
  } catch {
    return false;
  }
}

export function evaluateCleanup(audit, mergedBranches = new Set()) {
  const worktrees = audit.worktrees.filter(({ branch }) => branch !== "main").map((worktree) => {
    const branch = audit.branches.find(({ name }) => name === worktree.branch);
    const blockers = [];
    if (!worktree.branch) blockers.push("detached HEAD");
    if (!worktree.clean) blockers.push("worktree is dirty");
    if (!worktree.headInMain) blockers.push("HEAD is not in main");
    if (!branch?.upstream) blockers.push("branch has no upstream");
    if (branch?.ahead > 0) blockers.push(`branch is ${branch.ahead} commit(s) ahead of upstream`);
    if (worktree.branch && !mergedBranches.has(worktree.branch)) blockers.push("merged PR is not verified");
    return { path: worktree.path, branch: worktree.branch, eligible: blockers.length === 0, blockers };
  });

  const worktreeBranches = new Set(worktrees.map(({ branch }) => branch).filter(Boolean));
  const branches = audit.branches.filter(({ name }) => name !== "main").map((branch) => {
    const blockers = [];
    if (worktreeBranches.has(branch.name)) blockers.push("branch belongs to a listed worktree");
    if (!branch.headInMain) blockers.push("branch HEAD is not in main");
    if (!branch.upstream) blockers.push("branch has no upstream");
    if (branch.ahead > 0) blockers.push(`branch is ${branch.ahead} commit(s) ahead of upstream`);
    if (!mergedBranches.has(branch.name)) blockers.push("merged PR is not verified");
    return { name: branch.name, eligible: blockers.length === 0, blockers };
  });

  return { worktrees, branches };
}

export async function planWorkspaceCleanup(cwd = process.cwd()) {
  const audit = await auditWorkspace(cwd);
  const mergedBranches = new Set(
    audit.branches
      .filter(({ name }) => name !== "main")
      .filter(({ name }) => hasMergedPullRequest(audit.root, name))
      .map(({ name }) => name),
  );
  return { audit, plan: evaluateCleanup(audit, mergedBranches) };
}

function printPlan(plan, apply) {
  console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
  for (const worktree of plan.worktrees) {
    console.log(
      `worktree ${worktree.path}: ${worktree.eligible ? "eligible" : `blocked (${worktree.blockers.join("; ")})`}`,
    );
  }
  for (const branch of plan.branches) {
    console.log(`branch ${branch.name}: ${branch.eligible ? "eligible" : `blocked (${branch.blockers.join("; ")})`}`);
  }
}

export async function cleanupWorkspace(cwd = process.cwd(), { apply = false } = {}) {
  const { audit, plan } = await planWorkspaceCleanup(cwd);
  printPlan(plan, apply);
  if (!apply) return plan;

  for (const worktree of plan.worktrees.filter(({ eligible }) => eligible)) {
    git(audit.root, ["worktree", "remove", worktree.path]);
    git(audit.root, ["branch", "-d", worktree.branch]);
  }
  for (const branch of plan.branches.filter(({ eligible }) => eligible)) {
    git(audit.root, ["branch", "-d", branch.name]);
  }
  git(audit.root, ["worktree", "prune"]);
  return plan;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  await cleanupWorkspace(process.cwd(), { apply: process.argv.includes("--apply") });
}
