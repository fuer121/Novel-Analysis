import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { auditWorkspace } from "./workspace-audit.mjs";

function countActiveWorkRows(projectContent) {
  const lines = projectContent.split("\n");
  const start = lines.findIndex((line) => /^## Active Work\s*$/.test(line));
  if (start === -1) return 0;

  const section = lines.slice(start + 1);
  const end = section.findIndex((line) => /^##\s+/.test(line));
  const sectionLines = end === -1 ? section : section.slice(0, end);
  const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
  const isSeparator = (line) => line.trim().slice(1, -1).split("|")
    .every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
  const header = sectionLines.findIndex((line, index) => (
    isTableLine(line) && isSeparator(sectionLines[index + 1] || "")
  ));
  if (header === -1) return 0;

  let rows = 0;
  for (const line of sectionLines.slice(header + 2)) {
    if (!isTableLine(line)) break;
    rows += 1;
  }
  return rows;
}

function countLines(content) {
  if (content === "") return 0;
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

export function summarizeControllerHealth(audit, projectContent) {
  const mainWorktree = audit.worktrees.find(({ branch }) => branch === "main");
  const worktreesWithDependencies = audit.worktrees.filter(({ nodeModulesKb }) => nodeModulesKb > 0);

  return {
    workspace: {
      mainClean: mainWorktree?.clean === true,
      additionalWorktrees: audit.worktrees.filter(({ branch }) => branch !== "main").length,
      dirtyWorktrees: audit.worktrees.filter(({ clean }) => !clean).length,
      localBranches: audit.branches.length,
      nodeModulesCopies: worktreesWithDependencies.length,
      nodeModulesKb: worktreesWithDependencies.reduce((total, { nodeModulesKb }) => total + nodeModulesKb, 0),
      repositoryWorktreeKb: audit.localWorktreeDirectoryKb,
    },
    projectSource: {
      lines: countLines(projectContent),
      activeWorkRows: countActiveWorkRows(projectContent),
    },
  };
}

export function formatControllerHealth(summary) {
  return [
    "Controller Health",
    `Main clean: ${summary.workspace.mainClean}`,
    `Additional worktrees: ${summary.workspace.additionalWorktrees}`,
    `Dirty worktrees: ${summary.workspace.dirtyWorktrees}`,
    `Local branches: ${summary.workspace.localBranches}`,
    `Node modules copies: ${summary.workspace.nodeModulesCopies}`,
    `Node modules: ${summary.workspace.nodeModulesKb} KB`,
    `Repository .worktrees: ${summary.workspace.repositoryWorktreeKb} KB`,
    `Project source lines: ${summary.projectSource.lines}`,
    `Active work rows: ${summary.projectSource.activeWorkRows}`,
  ].join("\n");
}

export async function collectControllerHealth(cwd = process.cwd()) {
  const [audit, projectContent] = await Promise.all([
    auditWorkspace(cwd),
    fs.readFile(path.join(cwd, "docs/project/PROJECT.md"), "utf8"),
  ]);
  return summarizeControllerHealth(audit, projectContent);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const summary = await collectControllerHealth();
  console.log(process.argv.includes("--json")
    ? JSON.stringify(summary, null, 2)
    : formatControllerHealth(summary));
}
