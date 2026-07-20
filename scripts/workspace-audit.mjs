import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function parseWorktreeList(output) {
  return output.trim().split(/\n\n+/).filter(Boolean).map((block) => {
    const fields = Object.fromEntries(block.split("\n").map((line) => {
      const separator = line.indexOf(" ");
      return separator === -1 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    return {
      path: fields.worktree,
      head: fields.HEAD,
      branch: typeof fields.branch === "string"
        ? fields.branch.replace(/^refs\/heads\//, "")
        : null,
      detached: fields.detached === true,
    };
  });
}

function directorySizeKb(directory) {
  try {
    return Number(execFileSync("du", ["-sk", directory], { encoding: "utf8" }).trim().split(/\s+/, 1)[0]);
  } catch {
    return 0;
  }
}

async function directoryExists(directory) {
  try {
    return (await fs.stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function isAncestor(cwd, ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export async function auditWorkspace(cwd = process.cwd()) {
  const commonDirectory = path.resolve(cwd, git(cwd, ["rev-parse", "--git-common-dir"]));
  const root = path.dirname(commonDirectory);
  const worktrees = parseWorktreeList(git(root, ["worktree", "list", "--porcelain"]));
  const auditedWorktrees = await Promise.all(worktrees.map(async (worktree) => {
    const dependencyPath = path.join(worktree.path, "node_modules");
    return {
      ...worktree,
      clean: git(worktree.path, ["status", "--porcelain"]) === "",
      headInMain: isAncestor(root, worktree.head, "main"),
      nodeModulesKb: await directoryExists(dependencyPath) ? directorySizeKb(dependencyPath) : 0,
    };
  }));

  const checkedOutBranches = new Set(auditedWorktrees.map(({ branch }) => branch).filter(Boolean));
  const branchLines = git(root, [
    "for-each-ref",
    "--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)",
    "refs/heads",
  ]);
  const branches = branchLines ? branchLines.split("\n").map((line) => {
    const [name, upstream = "", tracking = ""] = line.split("\t");
    const ahead = Number(tracking.match(/ahead (\d+)/)?.[1] || 0);
    const behind = Number(tracking.match(/behind (\d+)/)?.[1] || 0);
    return {
      name,
      upstream: upstream || null,
      ahead,
      behind,
      checkedOut: checkedOutBranches.has(name),
      headInMain: isAncestor(root, name, "main"),
    };
  }) : [];

  const localWorktreeDirectory = path.join(root, ".worktrees");
  return {
    root,
    mainHead: git(root, ["rev-parse", "main"]),
    worktrees: auditedWorktrees,
    branches,
    localWorktreeDirectoryKb: await directoryExists(localWorktreeDirectory)
      ? directorySizeKb(localWorktreeDirectory)
      : 0,
  };
}

function printAudit(audit) {
  console.log(`Repository: ${audit.root}`);
  console.log(`Main HEAD: ${audit.mainHead}`);
  console.log(`Worktrees: ${audit.worktrees.length}`);
  for (const worktree of audit.worktrees) {
    console.log(
      `- ${worktree.path} | ${worktree.branch || "detached"} | clean=${worktree.clean}`
      + ` | headInMain=${worktree.headInMain} | nodeModules=${worktree.nodeModulesKb} KB`,
    );
  }
  console.log(`Local branches: ${audit.branches.length}`);
  for (const branch of audit.branches) {
    console.log(
      `- ${branch.name} | upstream=${branch.upstream || "none"} | ahead=${branch.ahead}`
      + ` | behind=${branch.behind} | checkedOut=${branch.checkedOut} | headInMain=${branch.headInMain}`,
    );
  }
  console.log(`Repository .worktrees: ${audit.localWorktreeDirectoryKb} KB`);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const audit = await auditWorkspace();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    printAudit(audit);
  }
}
