import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_FIELDS = [
  "project_id",
  "source_version",
  "baseline_commit",
  "baseline_status",
  "updated_at",
  "updated_by",
  "current_phase",
  "last_checkpoint",
  "next_gate",
];

const PROJECT_SECTIONS = [
  "Current Baseline",
  "Phase Status",
  "Active Work",
  "Effective Decisions",
  "Risks And Blockers",
  "Pending Feedback",
  "Next Gate",
  "Evidence Index",
  "Update Protocol",
];

const BASELINE_STATUSES = new Set(["current", "stale", "conflicted", "blocked"]);
const CHECKPOINT_STATUSES = new Set([
  "submitted",
  "validating",
  "accepted",
  "rejected",
  "superseded",
]);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function parseFrontMatter(content, label) {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error(`${label} has no front matter`);
  }

  const closingIndex = lines.indexOf("---", 1);
  if (closingIndex === -1) {
    throw new Error(`${label} has unterminated front matter`);
  }

  const fields = {};
  for (const line of lines.slice(1, closingIndex)) {
    const colonIndex = line.indexOf(":");
    if (colonIndex <= 0) {
      throw new Error(`${label} has invalid front matter line: ${line}`);
    }

    const key = line.slice(0, colonIndex).trim();
    if (!key || key in fields) {
      throw new Error(`${label} has invalid front matter field: ${key || line}`);
    }
    fields[key] = line.slice(colonIndex + 1).trim();
  }

  return fields;
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateLocalLinks(content, projectPath, errors) {
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const linkValue = match[1].trim();
    const angleBracketEnd = linkValue.startsWith("<") ? linkValue.indexOf(">") : -1;
    const target = angleBracketEnd > 0
      ? linkValue.slice(1, angleBracketEnd)
      : linkValue.split(/\s+/)[0];
    if (/^(?:https?:|mailto:|#)/i.test(target)) {
      continue;
    }

    const relativePath = target.split(/[?#]/, 1)[0];
    if (!relativePath) {
      continue;
    }

    const resolvedPath = path.resolve(path.dirname(projectPath), relativePath);
    if (!(await pathExists(resolvedPath))) {
      errors.push(`PROJECT.md local reference does not exist: ${target}`);
    }
  }
}

async function readCheckpoints(root, errors) {
  const checkpointDirectory = path.join(root, "docs/project/checkpoints");
  let entries;
  try {
    entries = await fs.readdir(checkpointDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Map();
    }
    errors.push(`Could not read checkpoint directory: ${error.message}`);
    return new Map();
  }

  const checkpoints = new Map();
  const markdownFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  for (const entry of markdownFiles) {
    const checkpointPath = path.join(checkpointDirectory, entry.name);
    let fields;
    try {
      const content = await fs.readFile(checkpointPath, "utf8");
      fields = parseFrontMatter(content, entry.name);
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    if (!CHECKPOINT_STATUSES.has(fields.status)) {
      errors.push(`${entry.name} has invalid checkpoint status: ${fields.status || "missing"}`);
    }
    if (!fields.checkpoint_id) {
      errors.push(`${entry.name} is missing required field checkpoint_id`);
      continue;
    }
    if (checkpoints.has(fields.checkpoint_id)) {
      errors.push(`Duplicate checkpoint_id: ${fields.checkpoint_id}`);
      continue;
    }

    checkpoints.set(fields.checkpoint_id, fields);
  }

  return checkpoints;
}

function validateGitBaseline(root, commit, errors) {
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    errors.push(`baseline_commit is not an ancestor of HEAD: ${commit}`);
  }
}

export async function validateProjectSource(root, { checkGit = true } = {}) {
  const projectPath = path.join(root, "docs/project/PROJECT.md");
  let content;
  let project;
  try {
    content = await fs.readFile(projectPath, "utf8");
    project = parseFrontMatter(content, "PROJECT.md");
  } catch (error) {
    return [`Could not read or parse PROJECT.md: ${error.message}`];
  }

  const errors = [];
  for (const field of PROJECT_FIELDS) {
    if (!project[field]) {
      errors.push(`PROJECT.md is missing required field ${field}`);
    }
  }

  const validCommit = COMMIT_PATTERN.test(project.baseline_commit || "");
  if (!validCommit) {
    errors.push("PROJECT.md baseline_commit must be 40 lowercase hexadecimal characters");
  }
  if (!BASELINE_STATUSES.has(project.baseline_status)) {
    errors.push(`PROJECT.md has invalid baseline_status: ${project.baseline_status || "missing"}`);
  }

  const sections = new Set(
    [...content.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]),
  );
  for (const section of PROJECT_SECTIONS) {
    if (!sections.has(section)) {
      errors.push(`PROJECT.md is missing required section: ${section}`);
    }
  }

  await validateLocalLinks(content, projectPath, errors);
  const checkpoints = await readCheckpoints(root, errors);
  const lastCheckpoint = checkpoints.get(project.last_checkpoint);
  if (!lastCheckpoint) {
    errors.push(`PROJECT.md last_checkpoint does not exist: ${project.last_checkpoint || "missing"}`);
  } else if (lastCheckpoint.status !== "accepted") {
    errors.push(
      `PROJECT.md last_checkpoint must be accepted: ${project.last_checkpoint} is ${lastCheckpoint.status}`,
    );
  }

  if (checkGit && validCommit) {
    validateGitBaseline(root, project.baseline_commit, errors);
  }

  return errors;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  const root = path.dirname(path.dirname(modulePath));
  const errors = await validateProjectSource(root);
  if (errors.length > 0) {
    for (const error of errors) {
      console.error(error);
    }
    process.exitCode = 1;
  } else {
    console.log("Project source of truth is valid");
  }
}
