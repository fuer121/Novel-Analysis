import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { DatabaseSync } from "node:sqlite";

const rootDir = process.cwd();
const sourceDataDir = path.resolve(rootDir, process.env.PREVIEW_SOURCE_DATA_DIR || "data");
const previewDataDir = path.resolve(rootDir, process.env.PREVIEW_DATA_DIR || "data-preview");
const sourceDbPath = path.join(sourceDataDir, "novel-chapters.sqlite");
const targetDbPath = path.join(previewDataDir, "novel-chapters.sqlite");
const tempDbPath = path.join(previewDataDir, `novel-chapters.sqlite.tmp-${process.pid}`);
const force = process.argv.includes("--force") || process.env.PREVIEW_FORCE === "1";

if (!fs.existsSync(sourceDbPath)) {
  console.error(`找不到正式数据库：${sourceDbPath}`);
  process.exit(1);
}

if (path.resolve(sourceDbPath) === path.resolve(targetDbPath)) {
  console.error("预览数据库路径不能和正式数据库相同。");
  process.exit(1);
}

fs.mkdirSync(previewDataDir, { recursive: true });

if (fs.existsSync(targetDbPath)) {
  console.warn("注意：将覆盖 data-preview/novel-chapters.sqlite，预览环境临时任务结果会丢弃。");
  if (!force) {
    if (!process.stdin.isTTY) {
      console.error("当前不是交互式终端。请使用 `npm run preview:prepare-data -- --force` 覆盖预览数据。");
      process.exit(1);
    }
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question("确认覆盖预览数据库？输入 y 继续：");
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("已取消。");
      process.exit(0);
    }
  }
}

removeIfExists(tempDbPath);

let db;
try {
  db = new DatabaseSync(sourceDbPath);
  db.exec(`VACUUM INTO '${escapeSqlPath(tempDbPath)}'`);
} finally {
  db?.close();
}

removeIfExists(targetDbPath);
removeIfExists(`${targetDbPath}-wal`);
removeIfExists(`${targetDbPath}-shm`);
fs.renameSync(tempDbPath, targetDbPath);

console.log(`预览数据库已生成：${targetDbPath}`);
console.log("这是正式数据的一次性快照，不会自动同步线上新增数据。");

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function escapeSqlPath(filePath) {
  return String(filePath).replaceAll("'", "''");
}
