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
const DECISION_STATUSES = new Set(["accepted", "rejected", "superseded"]);
const ACTIVE_WORK_COLUMNS = [
  "Task",
  "Phase",
  "Scope",
  "Owner",
  "Branch",
  "Base",
  "Head",
  "Status",
  "Depends On",
  "Checkpoint",
  "Next Action",
];
const ACTIVE_WORK_STATUSES = new Set([
  "planned",
  "ready",
  "in_progress",
  "review",
  "accepted",
  "merged",
  "blocked",
  "cancelled",
  "superseded",
]);
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TEMPLATE_SECTIONS = new Map([
  ["task-contract.md", [
    "Core Allowed Modules",
    "Mechanical Adjacent Scope",
    "Base Commit",
    "Success Criteria",
    "Prohibited Changes",
    "Required Verification",
    "Escalation Conditions",
    "Resource Budget",
  ]],
  ["checkpoint.md", [
    "Assigned Scope",
    "Prohibited Changes Audit",
    "Actual Changes",
    "Verification By Role",
    "Scope Deviations",
    "Escalations",
    "Risks And Blockers",
    "Recommended Next Action",
    "Acceptance Request",
  ]],
]);

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
    if (!line.trim()) {
      continue;
    }

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

async function validateGovernanceTemplates(root, errors) {
  for (const [fileName, requiredSections] of TEMPLATE_SECTIONS) {
    const templatePath = path.join(root, "docs/project/templates", fileName);
    let content;
    try {
      content = await fs.readFile(templatePath, "utf8");
    } catch (error) {
      errors.push(`Could not read governance template ${fileName}: ${error.message}`);
      continue;
    }

    const headings = new Set(
      [...content.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]),
    );
    for (const section of requiredSections) {
      if (!headings.has(section)) {
        errors.push(`${fileName} is missing required section: ${section}`);
      }
    }
  }
}

function isInsideRepository(root, target) {
  const relativePath = path.relative(root, target);
  return relativePath === "" || (
    relativePath !== ".."
    && !relativePath.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relativePath)
  );
}

async function validateLocalLinks(content, projectPath, root, errors) {
  const repositoryRoot = path.resolve(root);
  const realRepositoryRoot = await fs.realpath(repositoryRoot);
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

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(relativePath);
    } catch {
      errors.push(`PROJECT.md local reference is invalid: ${target}`);
      continue;
    }

    if (path.isAbsolute(decodedPath)) {
      errors.push(`PROJECT.md local reference is outside repository: ${target}`);
      continue;
    }

    const resolvedPath = path.resolve(path.dirname(projectPath), decodedPath);
    if (!isInsideRepository(repositoryRoot, resolvedPath)) {
      errors.push(`PROJECT.md local reference is outside repository: ${target}`);
      continue;
    }
    if (!(await pathExists(resolvedPath))) {
      errors.push(`PROJECT.md local reference does not exist: ${target}`);
      continue;
    }

    const realTarget = await fs.realpath(resolvedPath);
    if (!isInsideRepository(realRepositoryRoot, realTarget)) {
      errors.push(`PROJECT.md local reference is outside repository: ${target}`);
    }
  }
}

function parseMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return null;
  }
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim());
}

function validateActiveWork(content, errors) {
  const sectionMatch = content.match(/^## Active Work\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!sectionMatch) {
    return;
  }

  const lines = sectionMatch[1].split(/\r?\n/);
  const tableStart = lines.findIndex((line) => line.trim().startsWith("|"));
  const header = tableStart === -1 ? null : parseMarkdownRow(lines[tableStart]);
  const separator = tableStart === -1 ? null : parseMarkdownRow(lines[tableStart + 1] || "");
  if (!header || !separator) {
    errors.push("PROJECT.md Active Work must contain a Markdown table");
    return;
  }

  const missingColumns = ACTIVE_WORK_COLUMNS.filter((column) => !header.includes(column));
  if (header.length !== ACTIVE_WORK_COLUMNS.length
    || header.some((column, index) => column !== ACTIVE_WORK_COLUMNS[index])) {
    errors.push(
      `PROJECT.md Active Work columns must be exactly: ${ACTIVE_WORK_COLUMNS.join(", ")}`
      + (missingColumns.length > 0 ? `; missing: ${missingColumns.join(", ")}` : ""),
    );
  }
  if (separator.length !== header.length
    || separator.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    errors.push("PROJECT.md Active Work has an invalid table separator");
  }

  const rows = [];
  for (const line of lines.slice(tableStart + 2)) {
    const row = parseMarkdownRow(line);
    if (!row) {
      if (rows.length > 0) break;
      continue;
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    errors.push("PROJECT.md Active Work must contain at least one row");
    return;
  }

  for (const [rowIndex, row] of rows.entries()) {
    const rowLabel = `PROJECT.md Active Work row ${rowIndex + 1}`;
    if (row.length !== header.length) {
      errors.push(`${rowLabel} has ${row.length} cells; expected ${header.length}`);
      continue;
    }
    for (const [cellIndex, value] of row.entries()) {
      if (!value) {
        errors.push(`${rowLabel} has an empty ${header[cellIndex] || `column ${cellIndex + 1}`} cell`);
      }
    }
    const values = Object.fromEntries(header.map((column, index) => [column, row[index]]));
    if (!ACTIVE_WORK_STATUSES.has(values.Status)) {
      errors.push(`${rowLabel} has invalid status: ${values.Status || "missing"}`);
    }
    for (const field of ["Base", "Head"]) {
      if (values[field] !== "none" && !COMMIT_PATTERN.test(values[field] || "")) {
        errors.push(`${rowLabel} ${field.toLowerCase()} must be none or a 40-character lowercase commit SHA`);
      }
    }
  }
}

async function readGovernanceRecords(root, directoryName, config, errors) {
  const recordDirectory = path.join(root, `docs/project/${directoryName}`);
  let entries;
  try {
    entries = await fs.readdir(recordDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") {
      return new Map();
    }
    errors.push(`Could not read ${config.type} directory: ${error.message}`);
    return new Map();
  }

  const records = new Map();
  const markdownFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
  for (const entry of markdownFiles) {
    const recordPath = path.join(recordDirectory, entry.name);
    let content;
    let fields;
    try {
      content = await fs.readFile(recordPath, "utf8");
      fields = parseFrontMatter(content, entry.name);
    } catch (error) {
      errors.push(error.message);
      continue;
    }

    for (const field of config.requiredFields) {
      if (!fields[field]) {
        errors.push(`${entry.name} is missing required field ${field}`);
      }
    }
    if (!config.statuses.has(fields.status)) {
      errors.push(`${entry.name} has invalid ${config.type} status: ${fields.status || "missing"}`);
    }
    if (fields.recorded_at && Number.isNaN(Date.parse(fields.recorded_at))) {
      errors.push(`${entry.name} has invalid recorded_at: ${fields.recorded_at}`);
    }
    for (const field of config.commitFields || []) {
      if (fields[field] && !COMMIT_PATTERN.test(fields[field])) {
        errors.push(`${entry.name} ${field} must be 40 lowercase hexadecimal characters`);
      }
    }
    if (fields.supersedes && fields.supersedes !== "none"
      && !RECORD_ID_PATTERN.test(fields.supersedes)) {
      errors.push(`${entry.name} has invalid supersedes ID: ${fields.supersedes}`);
    }
    if (fields.status === "accepted" && config.acceptedSections) {
      const headings = new Set(
        [...content.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]),
      );
      for (const section of config.acceptedSections) {
        if (!headings.has(section)) {
          errors.push(`${entry.name} accepted ${config.type} is missing required section: ${section}`);
        }
      }
    }

    const recordId = fields[config.idField];
    if (!recordId) {
      continue;
    }
    if (records.has(recordId)) {
      errors.push(`Duplicate ${config.idField}: ${recordId}`);
      continue;
    }
    records.set(recordId, { fields, content, name: entry.name });
  }

  return records;
}

function validateSupersedes(records, type, errors) {
  const incoming = new Set();
  for (const [recordId, record] of records) {
    const target = record.fields.supersedes;
    if (!target || target === "none") continue;
    const acceptedSuperseder = record.fields.status === "accepted";
    if (!acceptedSuperseder) {
      errors.push(
        `${record.name} superseder must be accepted: ${recordId} is ${record.fields.status || "missing"}`,
      );
    }
    if (target === recordId) {
      errors.push(`${record.name} supersedes self: ${recordId}`);
    } else if (!records.has(target)) {
      errors.push(`${record.name} supersedes missing ${type}: ${target}`);
    } else if (acceptedSuperseder) {
      incoming.add(target);
    }
  }

  const visited = new Set();
  const active = new Set();
  function visit(recordId) {
    if (active.has(recordId)) {
      errors.push(`${type} supersedes cycle detected at ${recordId}`);
      return;
    }
    if (visited.has(recordId)) return;
    visited.add(recordId);
    active.add(recordId);
    const target = records.get(recordId)?.fields.supersedes;
    if (records.get(recordId)?.fields.status === "accepted"
      && target && target !== "none" && records.has(target) && target !== recordId) {
      visit(target);
    }
    active.delete(recordId);
  }
  for (const recordId of records.keys()) visit(recordId);

  for (const [recordId, record] of records) {
    if (record.fields.status === "superseded" && !incoming.has(recordId)) {
      errors.push(`${record.name} is superseded but is not targeted by another record's supersedes`);
    }
  }
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

async function validateAcceptedRecordImmutability(root, baseRef, errors) {
  if (!baseRef || /^0{40}$/.test(baseRef)) {
    return;
  }
  if (!COMMIT_PATTERN.test(baseRef)) {
    errors.push(`Project source baseRef must be a 40-character lowercase commit SHA: ${baseRef}`);
    return;
  }
  try {
    execFileSync("git", ["cat-file", "-e", `${baseRef}^{commit}`], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    errors.push(`Project source baseRef commit does not exist: ${baseRef}`);
    return;
  }

  let output;
  try {
    output = execFileSync(
      "git",
      ["ls-tree", "-r", "--name-only", baseRef, "--", "docs/project/checkpoints", "docs/project/decisions"],
      { cwd: root, encoding: "utf8" },
    );
  } catch (error) {
    errors.push(`Could not inspect project source baseRef: ${error.message}`);
    return;
  }

  const governanceDirectories = new Set([
    "docs/project/checkpoints",
    "docs/project/decisions",
  ]);
  const recordPaths = output.split(/\r?\n/).filter((recordPath) => (
    recordPath.endsWith(".md") && governanceDirectories.has(path.posix.dirname(recordPath))
  ));
  for (const recordPath of recordPaths) {
    let baseContent;
    try {
      baseContent = execFileSync("git", ["show", `${baseRef}:${recordPath}`], { cwd: root });
      const baseFields = parseFrontMatter(baseContent.toString("utf8"), `${recordPath} at ${baseRef}`);
      if (baseFields.status !== "accepted") continue;
      const currentContent = await fs.readFile(path.join(root, recordPath));
      if (!baseContent.equals(currentContent)) {
        errors.push(`accepted governance record is immutable: ${recordPath}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        errors.push(`accepted governance record is immutable: ${recordPath} was deleted`);
      } else {
        errors.push(`Could not compare governance record ${recordPath}: ${error.message}`);
      }
    }
  }
}

export async function validateProjectSource(
  root,
  { checkGit = true, baseRef = process.env.PROJECT_SOURCE_BASE_SHA || null } = {},
) {
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

  validateActiveWork(content, errors);
  await validateLocalLinks(content, projectPath, root, errors);
  await validateGovernanceTemplates(root, errors);
  const checkpoints = await readGovernanceRecords(root, "checkpoints", {
    type: "checkpoint",
    idField: "checkpoint_id",
    requiredFields: [
      "checkpoint_id",
      "task_id",
      "status",
      "recorded_at",
      "base_commit",
      "head_commit",
      "supersedes",
    ],
    statuses: CHECKPOINT_STATUSES,
    commitFields: ["base_commit", "head_commit"],
    acceptedSections: ["Scope", "Evidence", "Accepted Result"],
  }, errors);
  const decisions = await readGovernanceRecords(root, "decisions", {
    type: "decision",
    idField: "decision_id",
    requiredFields: ["decision_id", "status", "recorded_at", "confidence", "scope", "supersedes"],
    statuses: DECISION_STATUSES,
    acceptedSections: ["Decision", "Source"],
  }, errors);
  validateSupersedes(checkpoints, "checkpoint", errors);
  validateSupersedes(decisions, "decision", errors);
  const lastCheckpoint = checkpoints.get(project.last_checkpoint)?.fields;
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
  if (checkGit) {
    await validateAcceptedRecordImmutability(root, baseRef, errors);
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
