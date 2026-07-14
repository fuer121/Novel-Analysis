import crypto from "node:crypto";

import { config } from "./config.js";
import {
  createAnalysisRun,
  decryptAnalysisChapterResult,
  decryptAnalysisSummaryPartResult,
  decryptCompletedAnalysisChapterResults,
  decryptAnalysisPromptSnapshot,
  decryptChapterContent,
  decryptFinalAnalysisResult,
  ensureBook,
  getBook,
  getBookIndexPrompts,
  getBookIndexGroup,
  getPromptGroup,
  getAnalysisChapterMetadata,
  getAnalysisSummaryPartMetadata,
  getAnalysisRun,
  getExistingChapterIndexes,
  getL1ChapterIndex,
  getL1Coverage,
  getL2ChapterStatus,
  getL2Coverage,
  getPromptSettings,
  bookL1IndexPromptHash,
  indexGroupL2PromptHash,
  listBookIndexGroups,
  listL2Facts,
  listAnalysisChapterMetadata,
  listAnalysisSummaryPartMetadata,
  listChapterMetadata,
  listL1ChapterIndexes,
  normalizeBookId,
  normalizeBookName,
  normalizeChapterIndex,
  normalizeIndexGroupKey,
  normalizePromptSettings,
  normalizeRange,
  promptHash,
  saveAnalysisChapter,
  saveAnalysisSummaryPart,
  saveEncryptedChapter,
  saveFinalAnalysisResult,
  saveL1ChapterIndex,
  saveL2ChapterFacts,
  saveL2ChapterStatus,
  schemaHash,
  updateAnalysisRun,
  updateBookImportStatus
} from "./db.js";
import {
  buildChapterBatches,
  fetchChapterBatch,
  normalizeDifyAnalysisJsonOutput,
  normalizeDifyAnalysisTextOutput,
  normalizeDifyL1Output,
  normalizeDifyL2Output,
  runDifyWorkflow,
  testDifyConnection
} from "./dify.js";
import {
  buildChapterInput,
  buildL1ChapterInput,
  buildL2ChapterInput,
  callOpenAIJson,
  callOpenAIText,
  chapterResultSchema,
  l2ChapterFactsSchema,
  l1ChapterIndexSchema,
  testOpenAIConnection
} from "./openai.js";
import {
  assertNotCancelled,
  completeTask,
  createTask,
  failTask,
  findTask,
  isLiveTask,
  markTaskRunning,
  updateTask,
  waitIfPaused
} from "./tasks.js";
import { sanitizeText } from "./sanitize.js";

const SUMMARY_COMPACT_TARGET_CHARS = 28_000;
const SUMMARY_PART_INPUT_MAX_CHARS = 28_000;
const EVIDENCE_PACKET_CONTENT_CHARS = 260;
const EVIDENCE_PACKET_EVIDENCE_CHARS = 120;
const SUMMARY_FINAL_MAX_OUTPUT_TOKENS = 4500;
const CUSTOM_FIELD_SUMMARY_MAX_OUTPUT_TOKENS = 3000;
const SUMMARY_STAGE_MAX_ATTEMPTS = 3;
const SUMMARY_STAGE_RETRY_DELAY_MS = 1200;
const L2_QUERY_CANDIDATE_LIMIT = 2000;
const L2_QUERY_WINDOW_CHAPTERS = 120;
const L2_QUERY_MAX_FACTS = 160;
const L2_QUERY_COLLECTION_MAX_FACTS = 1200;
const L2_QUERY_DIFY_INPUT_MAX_CHARS = 20000;
const L2_SCHEMA_VERSION = "l2-facts-v1";
const FIELD_BATCH_MERGE_STRATEGY_VERSION = "recursive-object-v2";

export function l1IndexExecutionSignature(openaiModel = config.openai.model) {
  if (config.indexing.l1Provider === "dify") return `dify:l1:${config.dify.l1WorkflowVersion}`;
  return String(openaiModel || config.openai.model || "");
}

export function l2IndexExecutionSignature(openaiModel = config.openai.model) {
  if (config.indexing.l2Provider === "dify") return `dify:l2:${config.dify.l2WorkflowVersion}`;
  return String(openaiModel || config.openai.model || "");
}

export function analysisChapterExecutionSignature(openaiModel = config.openai.model) {
  if (config.indexing.analysisProvider === "dify") return `dify:analysis:chapter:${config.dify.analysisChapterWorkflowVersion}`;
  return String(openaiModel || config.openai.model || "");
}

export function analysisSummaryExecutionSignature(openaiModel = config.openai.model) {
  if (config.indexing.analysisProvider === "dify") return `dify:analysis:summary:${config.dify.analysisSummaryWorkflowVersion}`;
  return String(openaiModel || config.openai.model || "");
}

function l2QuerySummaryProvider() {
  return config.openai.apiKey ? "openai" : config.indexing.analysisProvider;
}

function l2QuerySummaryExecutionSignature(openaiModel = config.openai.model) {
  if (l2QuerySummaryProvider() === "dify") return `dify:analysis:summary:${config.dify.analysisSummaryWorkflowVersion}`;
  return String(openaiModel || config.openai.model || "");
}

export function startImportTask(payload) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const bookName = normalizeBookName(payload.book_name ?? payload.bookName);
  const range = normalizeRange(payload.start_chapter ?? payload.startChapter, payload.end_chapter ?? payload.endChapter);
  const force = Boolean(payload.force);
  const task = createTask("import", {
    bookId,
    bookName,
    startChapter: range.startChapter,
    endChapter: range.endChapter,
    force,
    autoL1Index: Boolean(payload.auto_l1_index ?? payload.autoL1Index)
  });

  void runImportTask(task, { bookId, bookName, ...range, force });
  return task;
}

export function startL1IndexTask(payload) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const range = normalizeRange(payload.start_chapter ?? payload.startChapter, payload.end_chapter ?? payload.endChapter);
  const force = Boolean(payload.force);
  const task = createTask("l1-index", {
    bookId,
    startChapter: range.startChapter,
    endChapter: range.endChapter,
    force,
    mode: "chapter-only"
  });

  void runL1IndexTask(task, { bookId, ...range, force });
  return task;
}

export function startL2IndexTask(payload) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const indexGroupKey = normalizeIndexGroupKey(payload.index_group_key ?? payload.indexGroupKey ?? "base");
  const range = normalizeRange(payload.start_chapter ?? payload.startChapter, payload.end_chapter ?? payload.endChapter);
  const force = Boolean(payload.force);
  const mode = normalizeL2BuildMode(payload.mode || payload.build_mode || payload.buildMode);
  const task = createTask("l2-index", {
    bookId,
    indexGroupKey,
    startChapter: range.startChapter,
    endChapter: range.endChapter,
    force,
    mode
  });

  void runL2IndexTask(task, { bookId, indexGroupKey, ...range, force, mode });
  return task;
}

export function startAnalysisTask(payload) {
  const bookId = normalizeBookId(payload.book_id ?? payload.bookId);
  const range = normalizeRange(payload.start_chapter ?? payload.startChapter, payload.end_chapter ?? payload.endChapter);
  const chapterIndexes = normalizeChapterIndexes(payload.chapter_indexes ?? payload.chapterIndexes);
  const name = String(payload.name || "").trim();
  const analysisMode = normalizeAnalysisMode(payload.analysis_mode ?? payload.analysisMode);
  const sourceReviewBudget = normalizeOptionalBudget(payload.source_review_budget ?? payload.sourceReviewBudget);
  const promptGroupId = String(payload.prompt_group_id ?? payload.promptGroupId ?? "").trim();
  const indexGroupKeys = normalizeIndexGroupKeysForWorkflow(payload.index_group_keys ?? payload.indexGroupKeys ?? []);
  const l2Query = String(payload.query ?? payload.l2_query ?? payload.l2Query ?? "").trim();
  const task = createTask("analysis", {
    name,
    bookId,
    startChapter: range.startChapter,
    endChapter: range.endChapter,
    chapterCount: chapterIndexes.length || range.total,
    analysisMode,
    query: analysisMode === "l2_query" ? l2Query : ""
  });

  void runAnalysisTask(task, {
    name,
    bookId,
    ...range,
    chapterIndexes,
    promptPatch: payload.prompt || {},
    promptGroupId,
    useL1Context: Boolean(payload.use_l1_context ?? payload.useL1Context),
    analysisMode,
    sourceReviewBudget,
    indexGroupKeys,
    l2Query
  });
  return task;
}

export function resumeAnalysisRunTask(id) {
  const analysisId = String(id || "");
  const existingTask = findTask(analysisId);
  if (isLiveTask(existingTask)) return existingTask;

  const run = getAnalysisRun(analysisId);
  if (!run) {
    const error = new Error("分析任务不存在。");
    error.status = 404;
    throw error;
  }
  if (run.ciphertext) {
    const error = new Error("分析任务已有最终结果，不需要续跑。");
    error.status = 409;
    throw error;
  }
  if (!run.prompt_ciphertext) {
    const error = new Error("旧任务缺少 Prompt 快照，无法安全续跑。请复制配置后新建分析任务。");
    error.status = 422;
    throw error;
  }

  const selection = parseChapterSelection(run);
  const task = createTask("analysis", {
    name: run.name,
    bookId: run.book_id,
    startChapter: run.start_chapter,
    endChapter: run.end_chapter,
    chapterCount: selection.chapter_indexes.length || run.chapter_count,
    resumeAnalysisId: analysisId
  }, { id: analysisId });

  void runAnalysisTask(task, {
    analysisId,
    resume: true,
    run
  });
  return task;
}

async function runImportTask(task, { bookId, bookName, startChapter, endChapter, total, force }) {
  try {
    ensureBook(bookId, bookName);
    updateBookImportStatus(bookId, "running");
    markTaskRunning(task, {
      progress: {
        total,
        completed: 0,
        failed: 0,
        skipped: 0,
        current: "准备导入"
      }
    });
    updateTask(task, {
      progress: { ...task.progress, current: "检查 Dify 配置" },
      message: "正在检查 Dify 工作流 API Key"
    });
    await testDifyConnection();

    const existing = force ? new Set() : getExistingChapterIndexes(bookId, startChapter, endChapter);
    const batches = buildChapterBatches(startChapter, endChapter);
    let lastBatchError = "";

    for (const batch of batches) {
      await waitIfPaused(task);
      const indexes = rangeIndexes(batch.startChapter, batch.endChapter);
      const missing = indexes.filter((index) => !existing.has(index));
      if (missing.length === 0) {
        task.progress.skipped += indexes.length;
        task.progress.completed += indexes.length;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过 ${batch.startChapter}-${batch.endChapter}` },
          message: `章节 ${batch.startChapter}-${batch.endChapter} 已存在，跳过。`
        });
        continue;
      }

      updateTask(task, {
        progress: { ...task.progress, current: `Dify 获取 ${batch.startChapter}-${batch.endChapter}` },
        message: `正在获取章节 ${batch.startChapter}-${batch.endChapter}`
      });

      try {
        const chapters = await fetchChapterBatch({
          bookId,
          startChapter: missing[0],
          endChapter: missing[missing.length - 1]
        });
        const byIndex = new Map(chapters.map((chapter) => [chapter.chapter_index, chapter]));

        for (const chapterIndex of missing) {
          await waitIfPaused(task);
          const chapter = byIndex.get(chapterIndex);
          if (!chapter || !chapter.content) {
            task.progress.failed += 1;
            updateTask(task, {
              progress: { ...task.progress, current: `章节 ${chapterIndex} 获取为空` },
              message: `章节 ${chapterIndex} 未返回正文。`
            }, "warning");
            continue;
          }

          await saveEncryptedChapter({
            bookId,
            chapterIndex,
            title: chapter.chapter_title,
            content: chapter.content,
            fetchStatus: chapter.fetch_status
          });
          task.progress.completed += 1;
          updateTask(task, {
            progress: { ...task.progress, current: `已保存章节 ${chapterIndex}` },
            message: `已加密保存章节 ${chapterIndex}`
          });
        }
      } catch (error) {
        if (error?.status === 499) throw error;
        lastBatchError = sanitizeText(error.message);
        task.progress.failed += missing.length;
        updateTask(task, {
          progress: { ...task.progress, current: `批次 ${batch.startChapter}-${batch.endChapter} 失败` },
          message: `批次失败：${sanitizeText(error.message)}`
        }, "warning");
      }
    }

    const savedCount = task.progress.completed - task.progress.skipped;
    if (task.progress.failed > 0 && savedCount <= 0) {
      updateBookImportStatus(bookId, "failed");
      const suffix = lastBatchError ? `最后一次 Dify 错误：${lastBatchError}` : "请检查 Dify API Base、Workflow API Key 和 Dify 工作流输入字段。";
      throw new Error(`所有待导入批次都失败了。${suffix}`);
    }

    const finalStatus = task.progress.failed > 0 ? "completed_with_errors" : "completed";
    updateBookImportStatus(bookId, finalStatus);
    completeTask(task, {
      bookId,
      chapters: listChapterMetadata(bookId),
      status: finalStatus
    });
  } catch (error) {
    if (error?.status === 499) {
      updateBookImportStatus(bookId, "cancelled");
      return;
    }
    updateBookImportStatus(bookId, "failed");
    failTask(task, error);
  }
}

async function runL1IndexTask(task, { bookId, startChapter, endChapter, force }) {
  const promptSettings = getPromptSettings();
  const bookPrompts = getBookIndexPrompts(bookId);
  const model = promptSettings.model;
  const reasoningEffort = promptSettings.reasoning_effort;
  const provider = config.indexing.l1Provider;
  const executionModel = l1IndexExecutionSignature(model);
  const indexPromptHash = bookL1IndexPromptHash(bookPrompts);
  try {
    const chapters = listChapterMetadata(bookId)
      .filter((chapter) => chapter.chapter_index >= startChapter && chapter.chapter_index <= endChapter);
    if (!chapters.length) {
      const error = new Error("本地章节库没有可构建 L1 索引的章节，请先导入章节原文。");
      error.status = 422;
      throw error;
    }

    if (provider === "dify") {
      await testDifyConnection({ target: "l1" });
    } else {
      await testOpenAIConnection();
    }
    markTaskRunning(task, {
      progress: {
        total: chapters.length,
        completed: 0,
        failed: 0,
        skipped: 0,
        current: "准备构建逐章 L1 索引"
      }
    });

    for (const chapter of chapters) {
      await waitIfPaused(task);
      const existing = getL1ChapterIndex(bookId, chapter.chapter_index);
      if (!force && existing?.status === "completed" && existing.source_hmac === chapter.content_hmac && existing.model === executionModel && existing.prompt_hash === indexPromptHash) {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} L1 索引已存在，跳过。`
        });
        continue;
      }

      updateTask(task, {
        progress: { ...task.progress, current: `L1 章节索引 ${chapter.chapter_index}` },
        message: `正在构建章节 ${chapter.chapter_index} L1 索引`
      });

      try {
        assertNotCancelled(task);
        const content = await decryptChapterContent(bookId, chapter.chapter_index);
        const value = provider === "dify"
          ? normalizeDifyL1Output(await runDifyWorkflow({
            apiKey: config.dify.l1ApiKey,
            target: "l1",
            inputs: {
              book_id: bookId,
              chapter_index: chapter.chapter_index,
              chapter_title: chapter.title || "",
              chapter_content: content,
              index_prompt: bookPrompts.l1_index_prompt
            }
          }))
          : (await callOpenAIJson({
            model,
            reasoningEffort,
            instructions: "你是小说 L1 章节路由/信号索引引擎。只输出符合 Schema 的 JSON。",
            input: buildL1ChapterInput({
              chapterIndex: chapter.chapter_index,
              title: chapter.title,
              content,
              indexPrompt: bookPrompts.l1_index_prompt
            }),
            schema: l1ChapterIndexSchema(),
            schemaName: "l1_chapter_index"
          })).value;
        saveL1ChapterIndex({
          bookId,
          chapterIndex: chapter.chapter_index,
          status: "completed",
          sourceHmac: chapter.content_hmac,
          model: executionModel,
          promptHash: indexPromptHash,
          value
        });
        task.progress.completed += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `章节 ${chapter.chapter_index} L1 完成` },
          message: `章节 ${chapter.chapter_index} L1 索引完成`
        });
        assertNotCancelled(task);
      } catch (error) {
        if (error?.status === 499) throw error;
        const safeMessage = sanitizeText(error.message);
        saveL1ChapterIndex({
          bookId,
          chapterIndex: chapter.chapter_index,
          status: "failed",
          sourceHmac: chapter.content_hmac,
          model: executionModel,
          promptHash: indexPromptHash,
          errorSummary: safeMessage
        });
        task.progress.failed += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `章节 ${chapter.chapter_index} L1 失败` },
          message: `章节 ${chapter.chapter_index} L1 失败：${safeMessage}`
        }, "warning");
        if (isFatalUpstreamError(safeMessage)) {
          throw new Error(`L1 构建已停止：${safeMessage}`, { cause: error });
        }
      }
    }

    completeTask(task, {
      bookId,
      coverage: getL1Coverage({ bookId, startChapter, endChapter, model: executionModel, promptHash: indexPromptHash, includeWindows: false })
    });
  } catch (error) {
    if (error?.status === 499) return;
    failTask(task, error);
  }
}

async function runL2IndexTask(task, { bookId, indexGroupKey, startChapter, endChapter, force, mode }) {
  try {
    const promptSettings = getPromptSettings();
    const indexGroup = getBookIndexGroup(bookId, indexGroupKey);
    if (!indexGroup || !indexGroup.enabled) {
      const error = new Error("索引组不存在或已禁用。");
      error.status = 404;
      throw error;
    }
    const model = promptSettings.model;
    const reasoningEffort = promptSettings.reasoning_effort;
    const provider = config.indexing.l2Provider;
    const executionModel = l2IndexExecutionSignature(model);
    const indexPromptHash = indexGroupL2PromptHash(indexGroup);
    const chapters = listChapterMetadata(bookId)
      .filter((chapter) => chapter.chapter_index >= startChapter && chapter.chapter_index <= endChapter);
    if (!chapters.length) {
      const error = new Error("本地章节库没有可构建 L2 索引的章节，请先导入章节原文。");
      error.status = 422;
      throw error;
    }

    if (provider === "dify") {
      await testDifyConnection({ target: "l2" });
    } else {
      await testOpenAIConnection();
    }
    markTaskRunning(task, {
      progress: {
        total: chapters.length,
        completed: 0,
        failed: 0,
        skipped: 0,
        current: `准备构建 ${indexGroup.name || indexGroup.group_key} L2 索引`
      }
    });

    for (const chapter of chapters) {
      await waitIfPaused(task);
      const existing = getL2ChapterStatus(bookId, chapter.chapter_index, indexGroup.group_key);
      const fresh = existing?.status === "completed"
        && existing.source_hmac === chapter.content_hmac
        && existing.model === executionModel
        && existing.prompt_hash === indexPromptHash
        && existing.schema_version === L2_SCHEMA_VERSION;
      if (mode === "retry_failed" && existing?.status !== "failed") {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} 不是失败状态，跳过。`
        });
        continue;
      }
      if (mode === "missing" && existing) {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} 已有 L2 记录，跳过。`
        });
        continue;
      }
      if (!force && mode === "all" && fresh) {
        task.progress.skipped += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
          message: `章节 ${chapter.chapter_index} L2 索引已存在，跳过。`
        });
        continue;
      }

      updateTask(task, {
        progress: { ...task.progress, current: `L2 事实索引 ${chapter.chapter_index}` },
        message: `正在构建章节 ${chapter.chapter_index} · ${indexGroup.name || indexGroup.group_key}`
      });

      try {
        assertNotCancelled(task);
        const content = await decryptChapterContent(bookId, chapter.chapter_index);
        const l1Index = getL1ChapterIndex(bookId, chapter.chapter_index);
        const l1Route = compactL1RouteForPrompt(l1Index);
        const facts = provider === "dify"
          ? normalizeDifyL2Output(await runDifyWorkflow({
            apiKey: config.dify.l2ApiKey,
            target: "l2",
            inputs: {
              book_id: bookId,
              index_group_key: indexGroup.group_key,
              chapter_index: chapter.chapter_index,
              chapter_title: chapter.title || "",
              chapter_content: content,
              l1_route_json: JSON.stringify(l1Route || null),
              index_prompt: indexGroup.l2_index_prompt
            }
          })).facts
          : (await callOpenAIJson({
            model,
            reasoningEffort,
            instructions: "你是小说 L2 类型化事实索引引擎。只输出符合 Schema 的 JSON。",
            input: buildL2ChapterInput({
              chapterIndex: chapter.chapter_index,
              title: chapter.title,
              content,
              l1Index: l1Route,
              indexPrompt: indexGroup.l2_index_prompt
            }),
            schema: l2ChapterFactsSchema(),
            schemaName: "l2_chapter_facts"
          })).value?.facts || [];
        await saveL2ChapterFacts({
          bookId,
          indexGroupKey: indexGroup.group_key,
          chapterIndex: chapter.chapter_index,
          status: "completed",
          sourceHmac: chapter.content_hmac,
          model: executionModel,
          promptHash: indexPromptHash,
          schemaVersion: L2_SCHEMA_VERSION,
          facts
        });
        task.progress.completed += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `章节 ${chapter.chapter_index} L2 完成` },
          message: `章节 ${chapter.chapter_index} L2 索引完成`
        });
        assertNotCancelled(task);
      } catch (error) {
        if (error?.status === 499) throw error;
        const safeMessage = sanitizeText(error.message);
        saveL2ChapterStatus({
          bookId,
          indexGroupKey: indexGroup.group_key,
          chapterIndex: chapter.chapter_index,
          status: "failed",
          sourceHmac: chapter.content_hmac,
          model: executionModel,
          promptHash: indexPromptHash,
          schemaVersion: L2_SCHEMA_VERSION,
          errorSummary: safeMessage
        });
        task.progress.failed += 1;
        updateTask(task, {
          progress: { ...task.progress, current: `章节 ${chapter.chapter_index} L2 失败` },
          message: `章节 ${chapter.chapter_index} L2 失败：${safeMessage}`
        }, "warning");
        if (isFatalUpstreamError(safeMessage)) {
          throw new Error(`L2 构建已停止：${safeMessage}`, { cause: error });
        }
      }
    }

    completeTask(task, {
      bookId,
      indexGroupKey: indexGroup.group_key,
      coverage: getL2Coverage({ bookId, indexGroupKey: indexGroup.group_key, startChapter, endChapter, model: executionModel, promptHash: indexPromptHash, schemaVersion: L2_SCHEMA_VERSION })
    });
  } catch (error) {
    failTask(task, error);
  }
}

async function runAnalysisTask(task, options) {
  const resume = Boolean(options.resume);
  const analysisId = options.analysisId || task.id;

  try {
    const prepared = resume
      ? await prepareResumedAnalysis(options.run || getAnalysisRun(analysisId))
      : await prepareNewAnalysis(analysisId, options);
    await executeAnalysisTask(task, prepared);
  } catch (error) {
    if (getAnalysisRun(analysisId)) {
      updateAnalysisRun(analysisId, {
        status: error?.status === 499 ? "cancelled" : "failed",
        error_summary: sanitizeText(error.message)
      });
    }
    if (error?.status === 499) return;
    failTask(task, error);
  }
}

async function prepareNewAnalysis(analysisId, { name, bookId, startChapter, endChapter, chapterIndexes, promptPatch, promptGroupId, useL1Context, analysisMode, sourceReviewBudget, indexGroupKeys = [], l2Query = "" }) {
  const settings = normalizePromptSettings({ ...getPromptSettings(), ...promptPatch });
  const promptGroup = promptGroupId ? getPromptGroup(promptGroupId) : null;
  const settingsWithDirectIndexes = indexGroupKeys.length ? { ...settings, index_group_keys: indexGroupKeys } : settings;
  const indexGroups = resolveAnalysisIndexGroups({ bookId, settings: settingsWithDirectIndexes, promptGroup });
  if (analysisMode === "l2_query") {
    validateL2QueryBeforeRun({ query: l2Query, indexGroups });
  } else {
    validateAnalysisPromptBeforeRun({
      settings,
      indexGroups,
      bookId,
      taskName: name || settings.name || ""
    });
  }
  const chapters = resolveSelectedChapters({ bookId, startChapter, endChapter, chapterIndexes });
  if (chapters.length === 0) {
    const error = new Error("本地章节库没有可分析的章节，请先导入章节原文。");
    error.status = 422;
    throw error;
  }
  const storedPromptHash = analysisMode === "l2_query"
    ? shaString(`${promptHash(settings)}:${l2Query}:${indexGroups.map((group) => group.group_key).join(",")}`)
    : promptHash(settings);

  await createAnalysisRun({
    id: analysisId,
    name,
    bookId,
    startChapter,
    endChapter,
    chapterSelection: {
      mode: chapterIndexes.length ? "indexes" : "range",
      chapter_indexes: chapters.map((chapter) => chapter.chapter_index)
    },
    model: analysisSummaryExecutionSignature(settings.model),
    reasoningEffort: settings.reasoning_effort,
    promptHash: storedPromptHash,
    schemaHash: schemaHash(settings),
    chapterCount: chapters.length,
    promptSnapshot: { ...settings, index_group_keys: indexGroups.map((group) => group.group_key), use_l1_context: useL1Context, analysis_mode: analysisMode, source_review_budget: sourceReviewBudget, l2_query: l2Query }
  });

  return {
    analysisId,
    bookId,
    startChapter,
    endChapter,
    chapters,
    settings,
    indexGroups,
    useL1Context,
    analysisMode,
    sourceReviewBudget,
    l2Query,
    chapterPromptHash: storedPromptHash,
    outputSchemaHash: schemaHash(settings),
    resume: false
  };
}

async function prepareResumedAnalysis(run) {
  if (!run) {
    const error = new Error("分析任务不存在。");
    error.status = 404;
    throw error;
  }
  if (run.ciphertext) {
    const error = new Error("分析任务已有最终结果，不需要续跑。");
    error.status = 409;
    throw error;
  }
  const settings = await decryptAnalysisPromptSnapshot(run.id);
  if (!settings) {
    const error = new Error("旧任务缺少 Prompt 快照，无法安全续跑。请复制配置后新建分析任务。");
    error.status = 422;
    throw error;
  }
  const normalizedSettings = normalizePromptSettings(settings);
  const indexGroups = resolveAnalysisIndexGroups({
    bookId: run.book_id,
    settings: {
      ...normalizedSettings,
      index_group_keys: settings.index_group_keys || []
    }
  });
  const analysisMode = normalizeAnalysisMode(settings.analysis_mode || "full_text");
  const l2Query = String(settings.l2_query || "").trim();
  if (analysisMode === "l2_query") {
    validateL2QueryBeforeRun({ query: l2Query, indexGroups });
  } else {
    validateAnalysisPromptBeforeRun({
      settings: normalizedSettings,
      indexGroups,
      bookId: run.book_id,
      taskName: run.name || normalizedSettings.name || ""
    });
  }
  const selection = parseChapterSelection(run);
  const chapters = resolveSelectedChapters({
    bookId: run.book_id,
    startChapter: run.start_chapter,
    endChapter: run.end_chapter,
    chapterIndexes: selection.chapter_indexes
  });
  return {
    analysisId: run.id,
    bookId: run.book_id,
    startChapter: run.start_chapter,
    endChapter: run.end_chapter,
    chapters,
    settings: normalizedSettings,
    indexGroups,
    useL1Context: Boolean(settings.use_l1_context),
    analysisMode,
    sourceReviewBudget: normalizeOptionalBudget(settings.source_review_budget),
    l2Query,
    chapterPromptHash: run.prompt_hash || promptHash(normalizedSettings),
    outputSchemaHash: run.schema_hash || schemaHash(normalizedSettings),
    resume: true
  };
}

function validateAnalysisPromptBeforeRun({ settings, indexGroups = [], bookId, taskName }) {
  if (!Array.isArray(indexGroups) || !indexGroups.length) {
    const error = new Error("分析模板必须显式绑定至少一个事实索引。请先在模板管理中选择并保存事实索引。");
    error.status = 422;
    throw error;
  }
  const finalSchema = deriveFinalSummarySchema({
    userPrompt: settings.summary_prompt,
    configuredSchema: parseOutputSchemaOrNull(settings.output_schema)
  });
  if (!shouldSplitCustomFinalSummary(finalSchema)) return;
  const properties = finalSchema.schema?.properties || {};
  const analysisContext = {
    bookId,
    bookName: getBook(bookId)?.book_name || "",
    taskName
  };
  for (const [fieldName, fieldSchema] of Object.entries(properties)) {
    if (!isAnalysisParameterField(fieldName, fieldSchema)) continue;
    deterministicFinalFieldValue(fieldName, analysisContext, {
      userPrompt: settings.summary_prompt,
      fieldSchema
    });
  }
}

function validateL2QueryBeforeRun({ query, indexGroups = [] }) {
  if (!String(query || "").trim()) {
    const error = new Error("L2 提问模式必须填写查询问题。");
    error.status = 422;
    throw error;
  }
  if (!Array.isArray(indexGroups) || !indexGroups.length) {
    const error = new Error("L2 提问模式必须选择至少一个事实索引。");
    error.status = 422;
    throw error;
  }
}

async function executeAnalysisTask(task, prepared) {
  const {
    analysisId,
    bookId,
    startChapter,
    endChapter,
    chapters,
    settings,
    indexGroups,
    useL1Context,
    analysisMode,
    sourceReviewBudget,
    l2Query,
    chapterPromptHash,
    outputSchemaHash,
    resume
  } = prepared;
  const model = settings.model;
  const reasoningEffort = settings.reasoning_effort;
  const analysisProvider = config.indexing.analysisProvider;
  const summaryProvider = analysisMode === "l2_query" ? l2QuerySummaryProvider() : analysisProvider;
  const chapterExecutionModel = analysisChapterExecutionSignature(model);
  const summaryExecutionModel = analysisSummaryExecutionSignature(model);

  if (analysisMode === "l2_query") {
    await ensureAnalysisSummaryProviderReady(summaryProvider);
  } else {
    await ensureAnalysisProviderReady(analysisProvider);
  }
  updateAnalysisRun(analysisId, {
    status: "running",
    error_summary: ""
  });
  markTaskRunning(task, {
    result: { analysisId },
    progress: {
      total: analysisMode === "l2_query" ? 1 : chapters.length + 1,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: analysisMode === "l2_query"
        ? "准备 L2 提问"
        : resume ? "准备续跑分析" : "准备逐章分析"
    }
  });

  if (analysisMode === "l2_query") {
    return executeL2QueryAnalysisTask(task, {
      analysisId,
      bookId,
      startChapter,
      endChapter,
      indexGroups,
      model,
      reasoningEffort,
      outputSchemaHash,
      query: l2Query
    });
  }

  if (analysisMode !== "full_text") {
    return executeIndexAnalysisTask(task, {
      analysisId,
      bookId,
      startChapter,
      endChapter,
      chapters,
      settings,
      indexGroups,
      model,
      reasoningEffort,
      outputSchemaHash,
      analysisMode,
      sourceReviewBudget
    });
  }

  const chapterResults = [];
  const failedChapters = [];
  const l1Context = useL1Context ? buildL1AnalysisContext({ bookId, chapters, startChapter, endChapter }) : null;
  if (useL1Context && l1Context?.missingChapters?.length) {
    updateTask(task, {
      progress: { ...task.progress, current: "L1 覆盖不完整" },
      message: `L1 上下文缺失章节：${l1Context.missingChapters.slice(0, 20).join(", ")}`
    }, "warning");
  }

  for (const chapter of chapters) {
    await waitIfPaused(task);
    const reusable = await reusableAnalysisChapter({
      analysisId,
      chapter,
      promptHash: chapterPromptHash,
      model: chapterExecutionModel
    });
    if (reusable) {
      chapterResults.push(reusable);
      task.progress.skipped += 1;
      updateTask(task, {
        progress: { ...task.progress, current: `跳过章节 ${chapter.chapter_index}` },
        message: `章节 ${chapter.chapter_index} 已有可复用结果，跳过。`
      });
      continue;
    }

    updateTask(task, {
      progress: { ...task.progress, current: `GPT 理解章节 ${chapter.chapter_index}` },
      message: `正在分析章节 ${chapter.chapter_index}`
    });

    try {
      assertNotCancelled(task);
      const content = await decryptChapterContent(bookId, chapter.chapter_index);
      const response = await callAnalysisJson({
        provider: analysisProvider,
        target: "analysis_chapter",
        model,
        reasoningEffort,
        instructions: "你是严谨的小说章节理解引擎。只输出符合 Schema 的 JSON。",
        input: buildChapterInput({
          chapterIndex: chapter.chapter_index,
          title: chapter.title,
          content,
          userPrompt: withL1ChapterContext(settings.chapter_prompt, l1Context?.chaptersByIndex.get(chapter.chapter_index))
        }),
        schema: chapterResultSchema(),
        schemaName: "chapter_result"
      });
      const value = {
        ...response.value,
        chapter_index: Number(response.value.chapter_index || chapter.chapter_index),
        chapter_title: String(response.value.chapter_title || chapter.title || "")
      };
      chapterResults.push(value);
      await saveAnalysisChapter({
        analysisId,
        chapterIndex: chapter.chapter_index,
        status: "completed",
        contentHmac: chapter.content_hmac,
        promptHash: chapterPromptHash,
        model: chapterExecutionModel,
        result: value
      });
      task.progress.completed += 1;
      updateTask(task, {
        progress: { ...task.progress, current: `章节 ${chapter.chapter_index} 完成` },
        message: `章节 ${chapter.chapter_index} 分析完成`
      });
      assertNotCancelled(task);
    } catch (error) {
      if (error?.status === 499) throw error;
      failedChapters.push(chapter.chapter_index);
      task.progress.failed += 1;
      await saveAnalysisChapter({
        analysisId,
        chapterIndex: chapter.chapter_index,
        status: "failed",
        contentHmac: chapter.content_hmac,
        promptHash: chapterPromptHash,
        model: chapterExecutionModel,
        errorSummary: sanitizeText(error.message)
      });
      updateTask(task, {
        progress: { ...task.progress, current: `章节 ${chapter.chapter_index} 失败` },
        message: `章节 ${chapter.chapter_index} 失败：${sanitizeText(error.message)}`
      }, "warning");
    }
  }

  chapterResults.sort((left, right) => Number(left.chapter_index || 0) - Number(right.chapter_index || 0));
  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "GPT 汇总分析结果" },
    message: "正在汇总逐章结果"
  });

  const summary = await summarizeAnalysisResults({
    analysisId,
    task,
    analysisContext: { bookId, bookName: getBook(bookId)?.book_name || "", taskName: task.payload?.name || settings.name || "" },
    model: summaryExecutionModel,
    requestModel: model,
    reasoningEffort,
    analysisProvider,
    chapterResults,
    failedChapters,
    userPrompt: settings.summary_prompt,
    outputSchema: settings.output_schema,
    sourceChapterCount: chapterResults.length
  });

  assertNotCancelled(task);
  const finalResult = parseJsonOrText(summary.value);
  assertFinalSummaryUseful(finalResult, chapterResults.length);
  await saveFinalAnalysisResult(analysisId, finalResult);
  task.progress.completed += 1;
  const run = updateAnalysisRun(analysisId, {
    status: "completed",
    error_summary: failedChapters.length ? `失败章节：${failedChapters.join(", ")}` : ""
  });
  completeTask(task, {
    analysisId,
    run: publicAnalysisRun(run),
    finalResult,
    failedChapters,
    schemaHash: outputSchemaHash
  });
}

async function executeL2QueryAnalysisTask(task, { analysisId, bookId, startChapter, endChapter, indexGroups = [], model, reasoningEffort, outputSchemaHash, query }) {
  const analysisProvider = l2QuerySummaryProvider();
  const summaryExecutionModel = l2QuerySummaryExecutionSignature(model);
  const inputBudget = l2QuerySummaryInputBudget(analysisProvider);
  const indexGroupKeys = indexGroups.map((group) => group.group_key);
  const queryIntent = buildL2QueryIntent(query, indexGroups);
  const targetContext = queryIntent.targetContext;
  const collectionMode = queryIntent.collectionMode;

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "L2 事实检索" },
    message: "正在从本地 L2 事实库检索问题相关事实"
  });

  const candidateScan = await collectL2QueryCandidateFacts({
    bookId,
    indexGroupKeys,
    startChapter,
    endChapter,
    windowChapters: L2_QUERY_WINDOW_CHAPTERS,
    perWindowLimit: L2_QUERY_CANDIDATE_LIMIT
  });
  const candidateFacts = candidateScan.facts;
  const recall = recallL2QueryFacts({
    facts: candidateFacts,
    query,
    targetContext,
    extraTerms: queryIntent.recallTerms,
    limit: collectionMode ? L2_QUERY_COLLECTION_MAX_FACTS : L2_QUERY_MAX_FACTS,
    allowExpandedLimit: collectionMode
  });
  const recalledChapters = [...new Set(recall.facts.map((fact) => Number(fact.chapter_index || 0)).filter(Boolean))]
    .sort((left, right) => left - right);
  const sourceStats = {
    analysis_mode: "l2_query",
    query,
    index_group_keys: indexGroupKeys,
    index_groups: indexGroups.map((group) => ({ group_key: group.group_key, name: group.name })),
    candidate_facts: candidateFacts.length,
    l2_query_candidate_windows: candidateScan.windows,
    l2_query_candidate_window_chapters: L2_QUERY_WINDOW_CHAPTERS,
    l2_query_candidate_limit_per_window: L2_QUERY_CANDIDATE_LIMIT,
    recalled_facts: recall.facts.length,
    recalled_chapters: recalledChapters.length,
    recalled_chapter_indexes: recalledChapters,
    matched_terms: recall.matchedTerms,
    expanded_terms: recall.expandedTerms,
    l2_query_intent: queryIntent.intent,
    l2_query_collection_reason: queryIntent.reason,
    l2_query_recall_terms: queryIntent.recallTerms,
    l2_query_summary_provider: analysisProvider,
    l2_query_configured_analysis_provider: config.indexing.analysisProvider,
    l2_query_scored_facts: recall.scoredFacts,
    l2_query_dropped_after_recall_limit: recall.droppedAfterRecallLimit,
    l2_query_collection_mode: collectionMode,
    l2_query_collection_candidate_facts: collectionMode ? recall.scoredFacts : 0,
    l2_query_collection_recall_limit: collectionMode ? L2_QUERY_COLLECTION_MAX_FACTS : 0,
    l2_query_chunk_input_budget: inputBudget,
    source_review_chapters: 0,
    source_review_budget: 0,
    target_subject: targetContext.subject,
    target_candidate_facts: recall.targetCandidateFacts,
    target_selected_facts: recall.targetSelectedFacts,
    target_recalled_facts: recall.targetSelectedFacts,
    target_recalled_chapters: recall.targetSelectedChapters,
    target_recall_fallback_used: false
  };

  if (!recall.facts.length) {
    Object.assign(sourceStats, {
      l2_query_material_mode: "direct",
      l2_query_chunk_count: 0,
      l2_query_recalled_facts_before_budget: 0,
      l2_query_recalled_facts_after_budget: 0,
      l2_query_omitted_by_budget: 0,
      l2_query_trimmed_by_budget: false
    });
    const finalResult = [
      "## L2 提问结果",
      "",
      "未召回相关 L2 事实。",
      "",
      `查询：${query}`,
      `事实索引：${indexGroups.map((group) => group.name || group.group_key).join(" / ") || "未指定"}`,
      `章节范围：${startChapter}-${endChapter}`
    ].join("\n");
    await saveFinalAnalysisResult(analysisId, finalResult);
    task.progress.completed = task.progress.total;
    const run = updateAnalysisRun(analysisId, {
      status: "completed",
      source_stats: JSON.stringify(sourceStats),
      error_summary: "未召回相关 L2 事实"
    });
    completeTask(task, {
      analysisId,
      run: publicAnalysisRun(run),
      finalResult,
      failedChapters: [],
      schemaHash: outputSchemaHash,
      sourceStats
    });
    return;
  }

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "GPT L2 提问汇总" },
    message: l2QuerySummaryProgressMessage({ recall, candidateFacts: candidateFacts.length, targetSubject: targetContext.subject, collectionMode })
  });
  Object.assign(sourceStats, {
    l2_query_material_mode: collectionMode ? "collection_direct" : "direct",
    l2_query_chunk_count: 1,
    l2_query_recalled_facts_before_budget: recall.facts.length,
    l2_query_recalled_facts_after_budget: recall.facts.length,
    l2_query_omitted_by_budget: 0,
    l2_query_trimmed_by_budget: false
  });
  const sourceMaterial = {
    query,
    targetContext,
    sourceStats,
    facts: recall.facts,
    evidence_packets: recall.facts.map(factToEvidencePacket).filter(Boolean)
  };
  const input = buildL2QuerySummaryInput({
    query,
    sourceMaterial,
    sourceStats
  });
  if (inputTextLength(input) > inputBudget) {
    await executeChunkedL2QueryAnalysisTask({
      task,
      analysisId,
      query,
      targetContext,
      sourceStats,
      recallFacts: recall.facts,
      analysisProvider,
      summaryExecutionModel,
      requestModel: model,
      reasoningEffort,
      outputSchemaHash,
      indexGroups,
      startChapter,
      endChapter,
      materialMode: collectionMode ? "collection_chunked" : "chunked",
      inputBudget
    });
    return;
  }
  const summaryTrace = sourceTraceFromMaterial({
    partKey: "l2_query.final.merge",
    stage: "text_final_merge",
    fieldName: "l2_query",
    material: sourceMaterial
  });
  const summary = await runL2QuerySummaryCallWithFallback({
    analysisId,
    task,
    partKey: "l2_query.final.merge",
    stageLabel: "GPT L2 提问汇总",
    model: summaryExecutionModel,
    requestModel: model,
    reasoningEffort,
    analysisProvider,
    userPrompt: query,
    input,
    schema: null,
    sourceChapterCount: Math.max(recall.facts.length, 1),
    traceSummary: summaryTrace,
    sourceStats,
    fallbackMarkdown: () => buildL2QueryDirectFallbackMarkdown({ query, facts: recall.facts, targetContext })
  });

  assertNotCancelled(task);
  const finalResult = parseJsonOrText(summary.value);
  assertFinalSummaryUseful(finalResult, Math.max(recall.facts.length, 1));
  await saveFinalAnalysisResult(analysisId, finalResult);
  task.progress.completed = task.progress.total;
  const run = updateAnalysisRun(analysisId, {
    status: "completed",
    source_stats: JSON.stringify(sourceStats),
    error_summary: ""
  });
  completeTask(task, {
    analysisId,
    run: publicAnalysisRun(run),
    finalResult,
    failedChapters: [],
    schemaHash: outputSchemaHash,
    sourceStats
  });
}

async function executeChunkedL2QueryAnalysisTask({
  task,
  analysisId,
  query,
  targetContext,
  sourceStats,
  recallFacts,
  analysisProvider,
  summaryExecutionModel,
  requestModel,
  reasoningEffort,
  outputSchemaHash,
  indexGroups,
  startChapter,
  endChapter,
  materialMode = "chunked",
  inputBudget = SUMMARY_PART_INPUT_MAX_CHARS
}) {
  Object.assign(sourceStats, {
    l2_query_material_mode: materialMode,
    l2_query_chunk_count: 0,
    l2_query_recalled_facts_before_budget: recallFacts.length,
    l2_query_recalled_facts_after_budget: 0,
    l2_query_omitted_by_budget: 0,
    l2_query_trimmed_by_budget: true
  });
  let chunks = splitL2QueryFactsIntoBudgetedChunks({
    query,
    targetContext,
    sourceStats,
    facts: recallFacts,
    budget: inputBudget
  });
  let keptFactCount = chunks.reduce((sum, chunk) => sum + chunk.rawFacts.length, 0);
  Object.assign(sourceStats, {
    l2_query_material_mode: materialMode,
    l2_query_chunk_count: chunks.length,
    l2_query_recalled_facts_before_budget: recallFacts.length,
    l2_query_recalled_facts_after_budget: keptFactCount,
    l2_query_omitted_by_budget: Math.max(0, recallFacts.length - keptFactCount),
    l2_query_trimmed_by_budget: true
  });
  chunks = chunks
    .map((chunk) => withL2QueryChunkInput({
      chunk,
      query,
      targetContext,
      sourceStats,
      budget: inputBudget
    }))
    .filter((chunk) => chunk.rawFacts.length);
  chunks = chunks.map((chunk, index) => ({
    ...chunk,
    batch: index + 1,
    total: chunks.length
  }));
  keptFactCount = chunks.reduce((sum, chunk) => sum + chunk.rawFacts.length, 0);
  Object.assign(sourceStats, {
    l2_query_chunk_count: chunks.length,
    l2_query_recalled_facts_after_budget: keptFactCount,
    l2_query_omitted_by_budget: Math.max(0, recallFacts.length - keptFactCount)
  });

  if (!chunks.length || !keptFactCount) {
    const finalResult = [
      "## L2 提问结果",
      "",
      "未召回相关 L2 事实，或相关事实在预算裁剪后不足以生成回答。",
      "",
      `查询：${query}`,
      `事实索引：${indexGroups.map((group) => group.name || group.group_key).join(" / ") || "未指定"}`,
      `章节范围：${startChapter}-${endChapter}`
    ].join("\n");
    await saveFinalAnalysisResult(analysisId, finalResult);
    task.progress.completed = task.progress.total;
    const run = updateAnalysisRun(analysisId, {
      status: "completed",
      source_stats: JSON.stringify(sourceStats),
      error_summary: "L2 提问预算裁剪后素材不足"
    });
    completeTask(task, {
      analysisId,
      run: publicAnalysisRun(run),
      finalResult,
      failedChapters: [],
      schemaHash: outputSchemaHash,
      sourceStats
    });
    return;
  }

  const batchResults = [];
  for (const chunk of chunks) {
    await waitIfPaused(task);
    updateTask(task, {
      progress: { ...task.progress, current: `GPT L2 提问分块 ${chunk.batch}/${chunk.total}` },
      message: `正在生成 L2 提问局部回答 ${chunk.batch}/${chunk.total}`
    });
    const partKey = `l2_query.batch.${String(chunk.batch).padStart(3, "0")}`;
    const traceSummary = sourceTraceFromMaterial({
      partKey,
      stage: "text_l2_query_batch",
      fieldName: "l2_query",
      material: {
        sourceStats: {
          ...sourceStats,
          evidence_packet_count: chunk.rawFacts.length,
          evidence_packets_trimmed_by_budget: chunk.trimmedByBudget,
          evidence_packets_omitted_by_budget: chunk.omittedByBudget
        },
        targetContext,
        target_subject: targetContext?.subject || "",
        split: {
          fieldName: "l2_query",
          materialLabel: "L2 提问事实分块",
          mode: "l2_query_batch",
          batch: chunk.batch,
          total: chunk.total
        },
        evidence_packets: chunk.rawFacts.map(factToEvidencePacket).filter(Boolean)
      }
    });
    const summary = await runL2QuerySummaryCallWithFallback({
      analysisId,
      task,
      partKey,
      stageLabel: `GPT L2 提问分块 ${chunk.batch}/${chunk.total}`,
      model: summaryExecutionModel,
      requestModel,
      reasoningEffort,
      analysisProvider,
      userPrompt: query,
      input: chunk.input,
      schema: null,
      sourceChapterCount: Math.max(chunk.rawFacts.length, 1),
      traceSummary,
      sourceStats,
      fallbackMarkdown: () => buildL2QueryBatchFallbackMarkdown({ query, chunk, targetContext })
    });
    const value = parseJsonOrText(summary.value);
    batchResults.push({
      batch: chunk.batch,
      total: chunk.total,
      chapters: chunk.chapters,
      fact_count: chunk.rawFacts.length,
      markdown: typeof value === "string" ? value : JSON.stringify(value)
    });
  }

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "GPT L2 提问分块合并" },
    message: `正在合并 ${batchResults.length} 个 L2 提问局部回答`
  });
  const mergeInput = buildL2QueryMergeInput({
    query,
    sourceStats,
    batchResults,
    budget: inputBudget
  });
  const finalMergeTrace = sourceTraceFromMaterial({
    partKey: "l2_query.final.merge",
    stage: "text_l2_query_merge",
    fieldName: "l2_query",
    material: {
      sourceStats,
      split: {
        fieldName: "l2_query",
        materialLabel: "L2 提问局部回答",
        mode: "l2_query_chunk_merge",
        batch: 1,
        total: batchResults.length
      },
      compressedResults: batchResults
    }
  });
  const finalSummary = await runL2QuerySummaryCallWithFallback({
    analysisId,
    task,
    partKey: "l2_query.final.merge",
    stageLabel: "GPT L2 提问分块合并",
    model: summaryExecutionModel,
    requestModel,
    reasoningEffort,
    analysisProvider,
    userPrompt: query,
    input: mergeInput,
    schema: null,
    sourceChapterCount: Math.max(keptFactCount, 1),
    traceSummary: finalMergeTrace,
    sourceStats,
    fallbackMarkdown: () => buildL2QueryMergeFallbackMarkdown({ query, batchResults })
  });

  assertNotCancelled(task);
  const finalResult = parseJsonOrText(finalSummary.value);
  assertFinalSummaryUseful(finalResult, Math.max(keptFactCount, 1));
  await saveFinalAnalysisResult(analysisId, finalResult);
  task.progress.completed = task.progress.total;
  const run = updateAnalysisRun(analysisId, {
    status: "completed",
    source_stats: JSON.stringify(sourceStats),
    error_summary: ""
  });
  completeTask(task, {
    analysisId,
    run: publicAnalysisRun(run),
    finalResult,
    failedChapters: [],
    schemaHash: outputSchemaHash,
    sourceStats
  });
}

async function runL2QuerySummaryCallWithFallback({
  analysisId,
  task,
  partKey,
  stageLabel,
  model,
  requestModel,
  reasoningEffort,
  analysisProvider,
  userPrompt,
  input,
  schema,
  sourceChapterCount,
  traceSummary,
  sourceStats,
  fallbackMarkdown
}) {
  try {
    return await runFinalSummaryCall({
      analysisId,
      task,
      partKey,
      stageLabel,
      model,
      requestModel,
      reasoningEffort,
      analysisProvider,
      userPrompt,
      input,
      schema,
      sourceChapterCount,
      traceSummary,
      errorLabel: "Dify L2 提问汇总"
  });
  } catch (error) {
    const fallbackReason = l2QuerySummaryFallbackReason(error);
    if (!fallbackReason) throw error;
    const markdown = fallbackMarkdown();
    const isMerge = partKey === "l2_query.final.merge";
    if (isMerge) {
      sourceStats.l2_query_merge_fallback_used = true;
    } else {
      sourceStats.l2_query_batch_fallback_count = Number(sourceStats.l2_query_batch_fallback_count || 0) + 1;
    }
    const fallbackTrace = {
      ...(traceSummary || {}),
      fallback_used: true,
      fallback_reason: fallbackReason,
      field_material_mode: isMerge ? "l2_query_merge_local_fallback" : "l2_query_batch_local_fallback"
    };
    await saveAnalysisSummaryPart({
      analysisId,
      partKey,
      parentKey: "",
      stage: isMerge ? "text_l2_query_merge" : "text_l2_query_batch",
      status: "completed",
      contentHash: summaryContentHash({ input, schema: null, userPrompt }),
      promptHash: shaString(userPrompt || ""),
      schemaHash: "",
      model,
      reasoningEffort,
      inputSummary: `${stageLabel} · 输入 ${inputTextLength(input)} 字 · 汇总器不可用后本地降级`,
      traceSummary: fallbackTrace,
      result: { value: markdown, responseId: null },
      errorSummary: ""
    });
    updateTask(task, {
      progress: {
        ...task.progress,
        summary_parts: await summaryProgressForAnalysis(analysisId)
      },
      message: `L2 提问分块已本地降级：${partKey}`
    });
    return { value: markdown, responseId: null };
  }
}

function l2QuerySummaryFallbackReason(error) {
  const message = String(error?.message || "");
  if (/Dify (分析工作流|L2 提问汇总)返回了空文本/.test(message)) return "dify_empty_text";
  if (/暂无可用上游|no available upstream|model.*unavailable|模型.*不可用|模型.*暂无|upstream/i.test(message)) return "summary_model_unavailable";
  if (/timeout|timed out|aborted|fetch failed|network|网络连接失败|unexpected end of json input/i.test(message)) return "summary_transport_unavailable";
  return "";
}

function buildL2QueryDirectFallbackMarkdown({ query, facts, targetContext }) {
  return buildL2QueryBatchFallbackMarkdown({
    query,
    targetContext,
    chunk: {
      batch: 1,
      total: 1,
      rawFacts: facts || []
    }
  });
}

function buildL2QueryBatchFallbackMarkdown({ query, chunk, targetContext }) {
  const lines = [
    "## L2 局部事实摘录（系统降级）",
    "",
    "Dify 分析汇总返回空文本；以下内容为系统按已召回 L2 facts 生成的保真摘录，未读取章节原文。",
    "",
    `查询：${query}`,
    targetContext?.subject ? `目标主体：${targetContext.subject}` : "",
    `分块：${chunk.batch}/${chunk.total}`,
    `事实数：${chunk.rawFacts.length}`,
    ""
  ].filter(Boolean);
  const facts = (chunk.rawFacts || []).map((fact) => compactL2QueryFactForBudget(fact, {
    factChars: 360,
    evidenceItems: 1,
    evidenceChars: 80
  }));
  for (const fact of facts) {
    const chapterLabel = fact.chapter_index ? `第${fact.chapter_index}章` : "章节不明";
    const typeLabel = fact.fact_type ? ` / ${fact.fact_type}` : "";
    const entityLabel = fact.entity ? ` / ${fact.entity}` : "";
    lines.push(`- **${chapterLabel}${typeLabel}${entityLabel}**：${fact.fact || "信息不足"}`);
    if (fact.evidence?.length) {
      lines.push(`  证据摘录：${fact.evidence.join("；")}`);
    }
  }
  return lines.join("\n");
}

function buildL2QueryMergeFallbackMarkdown({ query, batchResults }) {
  const lines = [
    "## L2 提问结果（系统降级合并）",
    "",
    "Dify 最终合并返回空文本；以下内容按各分块 Markdown 保真拼接，未读取章节原文。",
    "",
    `查询：${query}`,
    ""
  ];
  for (const result of batchResults || []) {
    const chapterRange = compactChapterSample(result.chapters || [], 8).join("、") || "章节不明";
    lines.push(`### 分块 ${result.batch}/${result.total}（${result.fact_count} 条事实；章节 ${chapterRange}）`);
    lines.push(clipText(result.markdown || "信息不足", 3000));
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function collectL2QueryCandidateFacts({ bookId, indexGroupKeys, startChapter, endChapter, windowChapters, perWindowLimit }) {
  const rangeStart = Number(startChapter || 0);
  const rangeEnd = Number(endChapter || 0);
  const size = Math.max(1, Number(windowChapters || L2_QUERY_WINDOW_CHAPTERS));
  const facts = [];
  let windows = 0;
  for (let currentStart = rangeStart; currentStart <= rangeEnd; currentStart += size) {
    const currentEnd = Math.min(rangeEnd, currentStart + size - 1);
    windows += 1;
    const batch = await listL2Facts({
      bookId,
      indexGroupKeys,
      startChapter: currentStart,
      endChapter: currentEnd,
      limit: perWindowLimit,
      includeContent: true
    });
    facts.push(...batch);
  }
  return {
    facts: dedupeFactsById(facts),
    windows
  };
}

function l2QuerySummaryInputBudget(provider) {
  return provider === "dify" ? L2_QUERY_DIFY_INPUT_MAX_CHARS : SUMMARY_PART_INPUT_MAX_CHARS;
}

async function executeIndexAnalysisTask(task, { analysisId, bookId, startChapter, endChapter, chapters, settings, indexGroups = [], model, reasoningEffort, outputSchemaHash, analysisMode, sourceReviewBudget }) {
  const analysisProvider = config.indexing.analysisProvider;
  const summaryExecutionModel = analysisSummaryExecutionSignature(model);
  const selectedIndexes = chapters.map((chapter) => chapter.chapter_index);
  const categories = inferL2CategoriesFromPrompt(settings.summary_prompt);
  const targetContext = buildTargetContext({ userPrompt: settings.summary_prompt });
  const entityQueries = mergeEntityQueries([
    targetContext.subject ? [targetContext.subject] : [],
    inferEntityQueriesFromPrompt(settings.summary_prompt, bookId)
  ]);
  const primaryEntityQuery = entityQueries[0] || "";
  const bookPrompts = getBookIndexPrompts(bookId);
  const l1PromptHash = bookL1IndexPromptHash(bookPrompts);
  const l1ExecutionModel = l1IndexExecutionSignature(model);
  const l2ExecutionModel = l2IndexExecutionSignature(model);
  const activeIndexGroups = indexGroups;
  const indexGroupKeys = activeIndexGroups.map((group) => group.group_key);
  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "L1 路标扫描" },
    message: "正在按 L1 路标筛选相关章节"
  });

  const l1Indexes = listL1ChapterIndexes(bookId, startChapter, endChapter)
    .filter((index) => selectedIndexes.includes(index.chapter_index));
  const l1FreshChapterSet = new Set(l1Indexes
    .filter((index) => {
      const chapter = chapters.find((entry) => entry.chapter_index === index.chapter_index);
      if (index.status !== "completed" || !chapter || index.source_hmac !== chapter.content_hmac) return false;
      if (index.model !== l1ExecutionModel) return false;
      if (index.prompt_hash === l1PromptHash) return true;
      return isLegacyReusableL1Route(index);
    })
    .map((index) => index.chapter_index));
  const l1MatchedIndexes = selectChaptersByL1Route({
    l1Indexes: l1Indexes.filter((index) => l1FreshChapterSet.has(index.chapter_index)),
    selectedIndexes,
    categories,
    entityQueries
  });
  const useL1Route = Boolean(l1MatchedIndexes.length);
  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "L2 召回事实" },
    message: useL1Route
      ? `正在按 L1 命中章节召回 L2 事实（${l1MatchedIndexes.length} 章）`
      : "L1 未命中相关章节，正在从本地 L2 索引兜底召回事实"
  });
  const initialFacts = await listL2Facts({
    bookId,
    indexGroupKeys,
    startChapter,
    endChapter,
    chapterIndexes: l1MatchedIndexes,
    categories,
    entities: useL1Route ? [] : entityQueries,
    limit: 1000,
    includeContent: true
  });
  const fallbackFacts = shouldFallbackL2Recall(initialFacts, entityQueries, useL1Route)
    ? await listL2Facts({
      bookId,
      indexGroupKeys,
      startChapter,
      endChapter,
      categories,
      limit: 500,
      includeContent: true
    })
    : [];
  const categoryFallbackFacts = shouldRetryL2RecallWithoutCategories({ initialFacts, categories, entityQueries })
    ? await listL2Facts({
      bookId,
      indexGroupKeys,
      startChapter,
      endChapter,
      chapterIndexes: l1MatchedIndexes,
      entities: entityQueries,
      limit: 1000,
      includeContent: true
    })
    : [];
  const facts = mergeFacts([...initialFacts, ...fallbackFacts, ...categoryFallbackFacts], { chronological: useL1Route })
    .filter((fact) => selectedIndexes.includes(fact.chapter_index));
  const indexedChapters = new Set(facts.map((fact) => fact.chapter_index));
  const unrecalledChapters = selectedIndexes.filter((index) => !indexedChapters.has(index));
  const l2Coverages = Object.fromEntries(activeIndexGroups.map((group) => [group.group_key, getL2Coverage({
    bookId,
    indexGroupKey: group.group_key,
    startChapter,
    endChapter,
    model: l2ExecutionModel,
    promptHash: indexGroupL2PromptHash(group),
    schemaVersion: L2_SCHEMA_VERSION
  })]));
  const l2MissingChapters = selectedIndexes.filter((index) => {
    const chapter = chapters.find((entry) => entry.chapter_index === index);
    if (!chapter) return true;
    return activeIndexGroups.some((group) => {
      const status = getL2ChapterStatus(bookId, index, group.group_key);
      return !status
        || status.status !== "completed"
        || status.source_hmac !== chapter.content_hmac
        || status.model !== l2ExecutionModel
        || status.prompt_hash !== indexGroupL2PromptHash(group)
        || status.schema_version !== L2_SCHEMA_VERSION;
    });
  });
  const recalledFactsByGroup = countBy(facts, "index_group_key");
  const sourceStats = {
    analysis_mode: analysisMode,
    index_group_keys: indexGroupKeys,
    index_groups: activeIndexGroups.map((group) => ({ group_key: group.group_key, name: group.name })),
    recalled_facts: facts.length,
    recalled_facts_by_group: recalledFactsByGroup,
    recalled_chapters: indexedChapters.size,
    l1_route_enabled: useL1Route,
    l1_matched_chapters: l1MatchedIndexes,
    l1_fresh_chapters: l1FreshChapterSet.size,
    l1_route_schema_versions: countBy(l1Indexes.filter((index) => l1FreshChapterSet.has(index.chapter_index)).map((index) => ({
      route_schema_version: index.route_schema_version || "legacy-l1-compatible"
    })), "route_schema_version"),
    source_review_chapters: 0,
    source_review_budget: sourceReviewBudgetForMode(analysisMode, chapters.length, sourceReviewBudget),
    missing_chapters: unrecalledChapters,
    unrecalled_chapters: unrecalledChapters,
    l2_missing_chapters: l2MissingChapters,
    l2_coverage: l2Coverages[indexGroupKeys[0]]?.chapters || null,
    l2_coverages: Object.fromEntries(Object.entries(l2Coverages).map(([key, coverage]) => [key, coverage.chapters])),
    categories,
    category_filter_fallback_used: Boolean(categoryFallbackFacts.length),
    entity_query: primaryEntityQuery,
    entity_queries: entityQueries,
    recall_fallback_used: Boolean(fallbackFacts.length),
    target_subject: targetContext.subject,
    target_recalled_facts: 0,
    target_recalled_chapters: 0,
    target_recall_fallback_used: false
  };

  const reviewedChapters = [];
  const reviewCandidates = analysisMode === "fast_index"
    ? []
    : selectSourceReviewCandidates({ facts, chapters, budget: sourceStats.source_review_budget });
  for (const chapter of reviewCandidates) {
    await waitIfPaused(task);
    updateTask(task, {
      progress: { ...task.progress, current: `原文复核 ${chapter.chapter_index}` },
      message: `正在按预算复核章节 ${chapter.chapter_index}`
    });
    const content = await decryptChapterContent(bookId, chapter.chapter_index);
    const response = await callAnalysisJson({
      provider: analysisProvider,
      target: "analysis_chapter",
      model,
      reasoningEffort: "low",
      instructions: "你是小说事实复核引擎。只针对用户汇总目标补充本章关键事实，输出符合 Schema 的 JSON。",
      input: buildL2ChapterInput({
        chapterIndex: chapter.chapter_index,
        title: chapter.title,
        content,
        l1Index: null,
        indexPrompt: activeIndexGroups[0]?.l2_index_prompt || bookPrompts.l2_index_prompt
      }),
      schema: l2ChapterFactsSchema(),
      schemaName: "l2_source_review"
    });
    const reviewFacts = (response.value?.facts || []).map((fact) => ({ ...fact, review_source: "source_review" }));
    reviewedChapters.push({
      chapter_index: chapter.chapter_index,
      title: chapter.title,
      facts: reviewFacts
    });
    sourceStats.source_review_chapters += 1;
  }
  const targetFacts = targetContext.subject
    ? facts.filter((fact) => factMatchesAnyEntity(fact, [targetContext.subject]))
    : [];
  const targetReviewedFacts = targetContext.subject
    ? reviewedChapters.flatMap((chapter) => (chapter.facts || [])
      .map((fact) => ({ ...fact, chapter_index: chapter.chapter_index }))
      .filter((fact) => factMatchesAnyEntity(fact, [targetContext.subject])))
    : [];
  sourceStats.target_recalled_facts = targetFacts.length + targetReviewedFacts.length;
  sourceStats.target_recalled_chapters = new Set([...targetFacts, ...targetReviewedFacts]
    .map((fact) => Number(fact.chapter_index || 0))
    .filter(Boolean)).size;
  sourceStats.target_recall_fallback_used = Boolean(targetContext.subject && !targetFacts.length && facts.length);

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "GPT 索引汇总结果" },
    message: "正在基于 L2 召回事实生成最终汇总"
  });
  const finalSchema = deriveFinalSummarySchema({
    userPrompt: settings.summary_prompt,
    configuredSchema: parseOutputSchemaOrNull(settings.output_schema)
  });
  const indexSummaryPayload = {
    facts,
    reviewedChapters,
    missingChapters: unrecalledChapters,
    userPrompt: settings.summary_prompt,
    sourceStats,
    targetContext
  };
  const finalPrepared = shouldSplitCustomFinalSummary(finalSchema)
    ? null
    : prepareEvidenceSourceMaterial({
      sourceMaterial: indexSummaryPayload,
      fieldName: "final",
      fieldSchema: finalSchema?.schema || null,
      userPrompt: settings.summary_prompt,
      materialLabel: "索引召回素材",
      budget: SUMMARY_PART_INPUT_MAX_CHARS
    });
  const summary = shouldSplitCustomFinalSummary(finalSchema)
      ? await runCustomFieldSummaryCalls({
      analysisId,
      task,
      analysisContext: { bookId, bookName: getBook(bookId)?.book_name || "", taskName: task.payload?.name || settings.name || "" },
          model: summaryExecutionModel,
          requestModel: model,
          reasoningEffort: "low",
          analysisProvider,
          userPrompt: settings.summary_prompt,
      sourceMaterial: indexSummaryPayload,
      materialLabel: "索引召回素材",
      schema: finalSchema,
      sourceChapterCount: Math.max(facts.length, reviewedChapters.length, 1)
    })
      : await runFinalSummaryCall({
      analysisId,
      task,
      partKey: "json.final.merge",
      stageLabel: "GPT 索引汇总结果",
          model: summaryExecutionModel,
          requestModel: model,
          reasoningEffort,
          analysisProvider,
          userPrompt: settings.summary_prompt,
      input: buildEvidenceSummaryInput({
        userPrompt: settings.summary_prompt,
        sourceMaterial: finalPrepared.material,
        materialLabel: "索引召回素材",
        contextLabel: "最终汇总"
      }),
      schema: finalSchema,
      sourceChapterCount: Math.max(facts.length, reviewedChapters.length, 1),
      traceSummary: sourceTraceFromMaterial({
        partKey: "json.final.merge",
        stage: "json_final_merge",
        fieldName: "final",
        material: finalPrepared.material
      })
    });

  assertNotCancelled(task);
  const finalResult = parseJsonOrText(summary.value);
  assertFinalSummaryUseful(finalResult, Math.max(facts.length, reviewedChapters.length, 1));
  await saveFinalAnalysisResult(analysisId, finalResult);
  task.progress.completed = task.progress.total;
  const run = updateAnalysisRun(analysisId, {
    status: "completed",
    source_stats: JSON.stringify(sourceStats),
    error_summary: sourceStats.l2_missing_chapters.length
      ? `L2 覆盖缺口章节：${sourceStats.l2_missing_chapters.slice(0, 30).join(", ")}`
      : sourceStats.unrecalled_chapters.length
        ? `L2 未召回章节：${sourceStats.unrecalled_chapters.slice(0, 30).join(", ")}`
        : ""
  });
  completeTask(task, {
    analysisId,
    run: publicAnalysisRun(run),
    finalResult,
    failedChapters: [],
    schemaHash: outputSchemaHash,
    sourceStats
  });
}

function selectSourceReviewCandidates({ facts, chapters, budget }) {
  if (!budget) return [];
  const byIndex = new Map(chapters.map((chapter) => [chapter.chapter_index, chapter]));
  const scores = new Map();
  for (const fact of facts) {
    const confidence = Number(fact.confidence || 0);
    const importance = Number(fact.importance || 0);
    if (importance < 0.65 && confidence >= 0.55) continue;
    const score = (importance * 2) + (1 - confidence);
    scores.set(fact.chapter_index, Math.max(scores.get(fact.chapter_index) || 0, score));
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([chapterIndex]) => byIndex.get(chapterIndex))
    .filter(Boolean)
    .slice(0, budget);
}

function selectChaptersByL1Route({ l1Indexes, selectedIndexes, categories, entityQueries }) {
  const selectedSet = new Set(selectedIndexes);
  const queries = entityQueries.map(normalizeRouteToken).filter(Boolean);
  const categorySet = new Set(categories || []);
  if (!queries.length && !categorySet.size) return [];
  return l1Indexes
    .filter((index) => selectedSet.has(index.chapter_index))
    .filter((index) => index.status === "completed")
    .filter((index) => {
      if (hasStructuredL1Route(index)) {
        return l1RouteMatchesQueries(index, queries) || l1RouteMatchesCategories(index, categorySet);
      }
      const routeText = legacyL1RouteText(index);
      return queries.some((query) => routeText.includes(query)) || legacyL1MatchesCategories(index, categorySet);
    })
    .map((index) => index.chapter_index)
    .sort((left, right) => left - right);
}

function hasStructuredL1Route(index) {
  return Boolean(index?.route_schema_version)
    || (Array.isArray(index?.route_entities) && index.route_entities.length)
    || (Array.isArray(index?.route_keywords) && index.route_keywords.length)
    || (Array.isArray(index?.signals) && index.signals.length);
}

function isLegacyReusableL1Route(index) {
  return typeof index?.prompt_hash === "string"
    && index.prompt_hash.startsWith("l1-v1-");
}

function l1RouteMatchesQueries(index, queries) {
  if (!queries.length) return false;
  const routeText = structuredL1RouteText(index);
  return queries.some((query) => routeText.includes(query));
}

function l1RouteMatchesCategories(index, categories) {
  if (!categories.size) return false;
  const signals = Array.isArray(index.signals) ? index.signals : [];
  const scores = index.category_scores && typeof index.category_scores === "object" ? index.category_scores : {};
  return [...categories].some((category) => {
    const score = Number(scores[category] || 0);
    if (score >= 0.35) return true;
    return signals.some((signal) => signal?.category === category && Number(signal.strength || 0) >= 0.35);
  });
}

function structuredL1RouteText(index) {
  const entities = Array.isArray(index.route_entities) ? index.route_entities : [];
  const signals = Array.isArray(index.signals) ? index.signals : [];
  return [
    ...(index.route_keywords || []),
    ...entities.flatMap((entity) => [
      entity?.name,
      entity?.type,
      entity?.role,
      entity?.note,
      ...(entity?.aliases || [])
    ]),
    ...signals.flatMap((signal) => [
      signal?.category,
      signal?.reason,
      ...(signal?.entities || []),
      ...(signal?.keywords || [])
    ])
  ].map(normalizeRouteToken).join(" ");
}

function compactL1RouteForPrompt(index) {
  if (!index) return null;
  if (hasStructuredL1Route(index)) {
    return {
      route_schema_version: index.route_schema_version || "l1-route-v1",
      route_entities: index.route_entities || [],
      route_keywords: index.route_keywords || [],
      signals: index.signals || [],
      category_scores: index.category_scores || {}
    };
  }
  return {
    route_schema_version: "legacy-l1-compatible",
    route_entities: normalizeLegacyRouteEntities(index.entities),
    route_keywords: normalizeLegacyRouteKeywords(index),
    signals: legacySignalsFromL1(index),
    category_scores: {}
  };
}

function normalizeLegacyRouteEntities(entities) {
  return (Array.isArray(entities) ? entities : []).map((entry) => {
    if (typeof entry === "string") {
      return { name: entry, type: "", aliases: [], role: "", note: "" };
    }
    return {
      name: String(entry?.name || "").trim(),
      type: String(entry?.type || "").trim(),
      aliases: Array.isArray(entry?.aliases) ? entry.aliases : [],
      role: "",
      note: String(entry?.note || "").trim()
    };
  }).filter((entry) => entry.name).slice(0, 16);
}

function normalizeLegacyRouteKeywords(index) {
  return [
    ...(index.keywords || []),
    ...(index.key_events || []),
    ...(index.items_places_orgs || []),
    ...(index.open_questions || [])
  ].map((entry) => {
    if (typeof entry === "string") return entry;
    return [entry?.name, entry?.type, entry?.note].filter(Boolean).join(" ");
  }).filter(Boolean).slice(0, 24);
}

function legacySignalsFromL1(index) {
  const signals = [];
  if (Array.isArray(index.entities) && index.entities.length) {
    signals.push({ category: "character", strength: 0.6, entities: normalizeLegacyRouteEntities(index.entities).map((entry) => entry.name), keywords: [], reason: "旧 L1 实体字段" });
  }
  if (Array.isArray(index.key_events) && index.key_events.length) {
    signals.push({ category: "event", strength: 0.6, entities: [], keywords: index.key_events.slice(0, 8), reason: "旧 L1 关键事件字段" });
  }
  if (Array.isArray(index.open_questions) && index.open_questions.length) {
    signals.push({ category: "foreshadowing", strength: 0.6, entities: [], keywords: index.open_questions.slice(0, 8), reason: "旧 L1 伏笔字段" });
  }
  return signals;
}

function legacyL1MatchesCategories(index, categories) {
  if (!categories.size) return false;
  if (categories.has("character") && Array.isArray(index.entities) && index.entities.length) return true;
  if (categories.has("relationship") && /关系|师徒|亲缘|恩怨|承诺|交易|敌对|隐瞒/.test(legacyL1RouteText(index))) return true;
  if (categories.has("cultivation") && /境界|修炼|剑道|武学|术法|文脉|儒|释|道|兵法/.test(legacyL1RouteText(index))) return true;
  if (categories.has("item") && /剑|本命物|法宝|武器|物品/.test(legacyL1RouteText(index))) return true;
  if (categories.has("force") && /宗门|势力|组织|门派|家族/.test(legacyL1RouteText(index))) return true;
  if (categories.has("location") && /地点|空间|秘境|城|山|洲|地图/.test(legacyL1RouteText(index))) return true;
  if (categories.has("event") && Array.isArray(index.key_events) && index.key_events.length) return true;
  if (categories.has("foreshadowing") && Array.isArray(index.open_questions) && index.open_questions.length) return true;
  return false;
}

function legacyL1RouteText(index) {
  return [
    index.summary,
    ...(index.keywords || []),
    ...(index.entities || []),
    ...(index.key_events || []),
    ...(index.items_places_orgs || []),
    ...(index.open_questions || [])
  ].map(normalizeRouteToken).join(" ");
}

function normalizeRouteToken(value) {
  return String(value || "").trim().toLowerCase();
}

function mergeFacts(facts, { chronological = false } = {}) {
  const seen = new Set();
  const merged = [];
  for (const fact of facts) {
    const key = fact?.id || [
      fact?.book_id,
      fact?.index_group_key,
      fact?.chapter_index,
      fact?.category,
      fact?.entity,
      fact?.fact_type,
      fact?.fact
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(fact);
  }
  const sorted = chronological
    ? merged.sort((left, right) => Number(left.chapter_index || 0) - Number(right.chapter_index || 0)
      || (Number(right.importance || 0) + Number(right.confidence || 0)) - (Number(left.importance || 0) + Number(left.confidence || 0)))
    : merged.sort((left, right) => {
      const leftScore = Number(left.importance || 0) * 2 + Number(left.confidence || 0);
      const rightScore = Number(right.importance || 0) * 2 + Number(right.confidence || 0);
      return rightScore - leftScore || Number(left.chapter_index || 0) - Number(right.chapter_index || 0);
    });
  return sorted.slice(0, 1200);
}

function recallL2QueryFacts({ facts, query, targetContext = null, extraTerms = [], limit = L2_QUERY_MAX_FACTS, allowExpandedLimit = false }) {
  const baseTerms = uniqueCompact([
    ...extractL2QueryTerms(query, targetContext?.subject),
    ...(Array.isArray(extraTerms) ? extraTerms : [])
  ].map(cleanupL2QueryTerm).filter(Boolean), 80);
  const initialTargetTerms = l2QueryTargetTerms(targetContext, baseTerms);
  const directTargetEntries = targetContext?.subject
    ? (Array.isArray(facts) ? facts : [])
      .filter((fact) => isStrongL2TargetMatch(fact, targetContext, initialTargetTerms))
      .map((fact) => ({ fact, score: 1000 + Number(fact?.importance || 0), matched: initialTargetTerms.length || 1 }))
    : [];
  const firstPassTerms = uniqueCompact([...baseTerms, ...initialTargetTerms], 80);
  const firstPass = scoreL2QueryFacts(facts, firstPassTerms)
    .filter((entry) => entry.score > 0)
    .sort(compareL2QueryScores);
  const targetSeedEntries = initialTargetTerms.length
    ? firstPass.filter((entry) => isStrongL2TargetMatch(entry.fact, targetContext, initialTargetTerms))
    : [];
  const expansionSourceEntries = directTargetEntries.length ? directTargetEntries : targetSeedEntries.length ? targetSeedEntries : firstPass;
  const expandedTerms = expandL2QueryTerms(
    expansionSourceEntries.slice(0, 80).map((entry) => entry.fact),
    baseTerms
  );
  const terms = uniqueCompact([...baseTerms, ...expandedTerms], 80);
  const scored = dedupeL2QueryScoreEntries(scoreL2QueryFacts(facts, terms)
    .filter((entry) => entry.score > 0)
    .sort(compareL2QueryScores));
  const requestedLimit = Number(limit) || L2_QUERY_MAX_FACTS;
  const maxFacts = allowExpandedLimit
    ? Math.max(1, requestedLimit)
    : Math.max(1, Math.min(L2_QUERY_MAX_FACTS, requestedLimit));
  const targetTerms = targetSeedEntries.length
    ? l2QueryTargetTerms(targetContext, expandL2QueryTerms(
      targetSeedEntries.slice(0, 80).map((entry) => entry.fact),
      initialTargetTerms
    ))
    : l2QueryTargetTerms(targetContext, baseTerms);
  const targetEntries = directTargetEntries.length
    ? directTargetEntries
    : targetTerms.length
      ? scored.filter((entry) => isStrongL2TargetMatch(entry.fact, targetContext, targetTerms))
    : [];
  const selectedEntries = targetEntries.length
    ? selectL2QueryTargetRecallEntries({
      scored,
      targetEntries,
      targetContext,
      supportTerms: expandedTerms,
      limit: directTargetEntries.length ? targetEntries.length : Math.max(maxFacts, targetEntries.length)
    })
    : selectL2QueryRecallEntries({
      scored,
      targetEntries,
      limit: maxFacts
    });
  const selected = selectedEntries.map((entry) => entry.fact)
    .sort((left, right) => Number(left.chapter_index || 0) - Number(right.chapter_index || 0)
      || Number(right.importance || 0) - Number(left.importance || 0));
  return {
    facts: selected,
    matchedTerms: terms.filter((term) => selected.some((fact) => l2QueryFactSearchText(fact).includes(normalizeRouteToken(term)))).slice(0, 40),
    expandedTerms,
    scoredFacts: scored.length,
    targetCandidateFacts: targetEntries.length,
    targetSelectedFacts: selectedEntries.filter((entry) => targetEntries.includes(entry)).length,
    targetSelectedChapters: new Set(selectedEntries
      .filter((entry) => targetEntries.includes(entry))
      .map((entry) => Number(entry?.fact?.chapter_index || 0))
      .filter(Boolean)).size,
    droppedAfterRecallLimit: Math.max(0, scored.length - selectedEntries.length)
  };
}

function l2QuerySummaryProgressMessage({ recall, candidateFacts, targetSubject, collectionMode = false }) {
  const recalled = Number(recall?.facts?.length || 0);
  const targetCandidates = Number(recall?.targetCandidateFacts || 0);
  if (targetSubject && targetCandidates) {
    return `正在基于 ${recalled}/${targetCandidates} 条目标 L2 事实生成回答（全库候选 ${candidateFacts} 条）`;
  }
  if (collectionMode) {
    return `正在基于 ${recalled} 条集合候选 L2 事实分块提取（全库候选 ${candidateFacts} 条）`;
  }
  return `正在基于 ${recalled}/${candidateFacts} 条 L2 事实生成回答`;
}

function dedupeL2QueryScoreEntries(entries) {
  const seen = new Set();
  const output = [];
  for (const entry of entries || []) {
    const fact = entry?.fact;
    const key = fact?.id || [
      fact?.book_id,
      fact?.index_group_key,
      fact?.chapter_index,
      fact?.category,
      fact?.entity,
      fact?.fact_type,
      fact?.fact
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function selectL2QueryRecallEntries({ scored, targetEntries, limit }) {
  const selected = [];
  const seen = new Set();
  const addEntry = (entry) => {
    const key = l2QueryScoreEntryKey(entry);
    if (!key || seen.has(key) || selected.length >= limit) return false;
    seen.add(key);
    selected.push(entry);
    return true;
  };

  const targetSelection = selectCoveragePreservingL2QueryEntries(targetEntries, Math.min(limit, targetEntries.length));
  for (const entry of targetSelection) addEntry(entry);
  for (const entry of scored || []) addEntry(entry);
  return selected;
}

function selectL2QueryTargetRecallEntries({ scored, targetEntries, targetContext = null, supportTerms = [], limit }) {
  const targetSelection = selectCoveragePreservingL2QueryEntries(targetEntries, Math.min(limit, targetEntries.length));
  const ownerTerms = targetOwnerTerms(targetContext);
  if (ownerTerms.length) return targetSelection;
  const supportEntries = (scored || []).filter((entry) => {
    if (targetEntries.includes(entry)) return false;
    const haystack = l2QueryFactSearchText(entry.fact);
    const supportMatched = supportTerms.some((term) => haystack.includes(normalizeRouteToken(term)));
    if (!supportMatched) return false;
    return true;
  });
  const supportLimit = Math.min(
    Math.max(0, limit - targetSelection.length),
    Math.max(8, Math.min(48, targetEntries.length * 2))
  );
  const supportSelection = selectCoveragePreservingL2QueryEntries(supportEntries, supportLimit);
  return [...targetSelection, ...supportSelection];
}

function selectCoveragePreservingL2QueryEntries(entries, limit) {
  const input = Array.isArray(entries) ? entries : [];
  if (!limit || input.length <= limit) return input.slice(0, limit);

  const selected = [];
  const seen = new Set();
  const addEntry = (entry) => {
    const key = l2QueryScoreEntryKey(entry);
    if (!key || seen.has(key) || selected.length >= limit) return false;
    seen.add(key);
    selected.push(entry);
    return true;
  };

  const topCount = Math.max(1, Math.floor(limit * 0.6));
  for (const entry of input.slice(0, topCount)) addEntry(entry);

  const bestByChapter = new Map();
  for (const entry of input) {
    const chapter = Number(entry?.fact?.chapter_index || 0);
    if (!chapter || bestByChapter.has(chapter)) continue;
    bestByChapter.set(chapter, entry);
  }
  const coverageEntries = [...bestByChapter.values()]
    .sort((left, right) => Number(left.fact?.chapter_index || 0) - Number(right.fact?.chapter_index || 0));
  for (const entry of evenlySampleL2QueryEntries(coverageEntries, limit - selected.length)) addEntry(entry);
  for (const entry of input) addEntry(entry);
  return selected;
}

function evenlySampleL2QueryEntries(entries, count) {
  const input = Array.isArray(entries) ? entries : [];
  if (count <= 0) return [];
  if (input.length <= count) return input;
  if (count === 1) return [input[input.length - 1]];
  const output = [];
  const seen = new Set();
  for (let index = 0; index < count; index += 1) {
    const sourceIndex = Math.round((index * (input.length - 1)) / (count - 1));
    const entry = input[sourceIndex];
    const key = l2QueryScoreEntryKey(entry);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(entry);
  }
  return output;
}

function l2QueryScoreEntryKey(entry) {
  const fact = entry?.fact;
  if (!fact) return "";
  return fact.id || [
    fact.book_id,
    fact.index_group_key,
    fact.chapter_index,
    fact.category,
    fact.entity,
    fact.fact_type,
    fact.fact
  ].join("|");
}

function l2QueryTargetTerms(targetContext, baseTerms = []) {
  const target = targetContext?.subject || "";
  if (!target) return [];
  return uniqueCompact([
    target,
    ...(Array.isArray(targetContext?.aliases) ? targetContext.aliases : []),
    ...baseTerms.filter(isLikelyL2TargetAliasTerm)
  ], 12);
}

function targetOwnerTerms(targetContext) {
  const possessive = splitPossessiveTargetSubject(targetContext?.subject || "");
  if (!possessive?.owner) return [];
  return uniqueCompact([
    possessive.owner,
    ...l2QuerySubTerms(possessive.owner)
  ].map(cleanupL2QueryTerm).filter(Boolean), 6);
}

function targetDescriptorTerms(targetContext) {
  const aliases = Array.isArray(targetContext?.aliases) ? targetContext.aliases : [];
  const possessive = splitPossessiveTargetSubject(targetContext?.subject || "");
  const object = possessive?.object || "";
  const descriptors = [...aliases];
  if (object) {
    descriptors.push(object);
    const suffix = object.match(/(法袍|飞剑|本命飞剑|本命物|佩剑|长剑|短剑|重剑|古剑|剑胚|剑鞘|剑匣|法宝|宝甲|甲胄|道袍|衣袍|长袍)$/);
    if (suffix?.[1] && normalizeRouteToken(object) === normalizeRouteToken(suffix[1])) descriptors.push(suffix[1]);
  }
  return uniqueCompact(descriptors.map(cleanupL2QueryTerm).filter(Boolean), 12);
}

function isStrongL2TargetMatch(fact, targetContext, targetTerms = []) {
  if (!fact || !targetContext?.subject) return false;
  const ownerTerms = targetOwnerTerms(targetContext);
  const descriptorTerms = targetDescriptorTerms(targetContext);
  if (ownerTerms.length && descriptorTerms.length) {
    if (factMatchesAnyEntity(fact, [targetContext.subject])) return true;
    const haystack = l2QueryFactSearchText(fact);
    const ownerMatched = ownerTerms.every((term) => haystack.includes(normalizeRouteToken(term)));
    const descriptorMatched = descriptorTerms.some((term) => haystack.includes(normalizeRouteToken(term)));
    return ownerMatched && descriptorMatched;
  }
  const explicitAliases = uniqueCompact([
    targetContext.subject,
    ...(Array.isArray(targetContext?.aliases) ? targetContext.aliases : [])
  ].map(cleanupL2QueryTerm).filter(Boolean), 8);
  if (explicitAliases.length && factMatchesAnyStructuredTargetField(fact, explicitAliases)) return true;
  if (targetTerms.length) return factMatchesAnyStructuredTargetField(fact, targetTerms);
  return false;
}

function factMatchesAnyStructuredTargetField(fact, terms = []) {
  const fields = [
    fact?.entity,
    ...(Array.isArray(fact?.aliases) ? fact.aliases : []),
    ...(Array.isArray(fact?.tags) ? fact.tags : []),
    ...(Array.isArray(fact?.related_entities) ? fact.related_entities : [])
  ].map(normalizeRouteToken).filter(Boolean);
  const normalizedTerms = uniqueCompact((terms || []).map(normalizeRouteToken).filter(Boolean), 16);
  return normalizedTerms.some((term) => fields.some((field) => field === term || (term.length >= 3 && field.includes(term))));
}

function isLikelyL2TargetAliasTerm(value) {
  const text = normalizeRouteToken(value);
  if (!text || text.length < 2 || text.length > 12) return false;
  if (/以及|对应|章节|事实|内容|结果|要求|时间线|演化/.test(text)) return false;
  if (/^(飞剑|剑类|陈平安|养剑葫|战绩|能力|来源|外形|形态|性格|本命飞剑|other|appearance|ability|trait|ownership|combat_record)$/.test(text)) return false;
  return true;
}

function scoreL2QueryFacts(facts, terms) {
  const normalizedTerms = uniqueCompact(terms.map(normalizeRouteToken).filter((term) => term.length >= 2), 80);
  return (Array.isArray(facts) ? facts : []).map((fact) => {
    const haystack = l2QueryFactSearchText(fact);
    const contentText = normalizeRouteToken(fact?.fact || "");
    const entityText = normalizeRouteToken(fact?.entity || "");
    let score = Number(fact?.importance || 0) * 2 + Number(fact?.confidence || 0);
    let matched = 0;
    for (const term of normalizedTerms) {
      if (!haystack.includes(term)) continue;
      matched += 1;
      score += 2;
      if (contentText.includes(term)) score += 2.5;
      if (entityText === term) score += 4;
      if (term.length >= 3) score += 0.8;
    }
    return { fact, score: matched ? score : 0, matched };
  });
}

function compareL2QueryScores(left, right) {
  return right.score - left.score
    || right.matched - left.matched
    || Number(right.fact?.importance || 0) - Number(left.fact?.importance || 0)
    || Number(left.fact?.chapter_index || 0) - Number(right.fact?.chapter_index || 0);
}

function dedupeFactsById(facts) {
  const seen = new Set();
  const output = [];
  for (const fact of facts || []) {
    const key = fact?.id || [
      fact?.book_id,
      fact?.index_group_key,
      fact?.chapter_index,
      fact?.category,
      fact?.entity,
      fact?.fact_type,
      fact?.fact
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(fact);
  }
  return output;
}

function buildL2QueryIntent(query, indexGroups = []) {
  const reason = l2QueryCollectionReason(query, indexGroups);
  const collectionMode = Boolean(reason);
  const targetContext = collectionMode
    ? { subject: "", aliases: [], source: "collection" }
    : buildTargetContext({ userPrompt: query });
  const recallTerms = buildL2QueryIntentRecallTerms(query, indexGroups, { collectionMode });
  return {
    intent: collectionMode ? "collection" : targetContext.subject ? "target" : "query",
    collectionMode,
    targetContext,
    recallTerms,
    reason
  };
}

function l2QueryCollectionReason(query, indexGroups = []) {
  const text = normalizeRouteToken(query);
  if (!text || isExplicitSingleTargetL2Query(text)) return "";
  const contextText = normalizeRouteToken([
    query,
    ...(indexGroups || []).flatMap((group) => [
      group?.name,
      group?.description,
      group?.l2_index_prompt,
      ...(Array.isArray(group?.category_scope) ? group.category_scope : []),
      ...(Array.isArray(group?.trigger_keywords) ? group.trigger_keywords : [])
    ])
  ].filter(Boolean).join(" "));
  const hits = [];
  if (/提取|整理|汇总|列出|输出|清单|列表/.test(text)) hits.push("清单");
  if (/排名|排行|top\s*\d+|前\s*\d+|取前|取\d+|前三|前五|前十|最重要|重要程度|最强/.test(text)) hits.push("排行");
  if (/最强/.test(text)) hits.push("最强");
  if (/每个|每一|各个|各境|分境界|分层|逐境界/.test(text)) hits.push("分组");
  if (/最强人物|人物境界|境界排名/.test(text)) hits.push("修炼体系排行");
  const asksForCollection = hits.length > 0;
  const asksForManyItems = /所有|全部|多把|一批|前\s*\d+|top\s*\d+|取前|取\d+|前三|前五|前十|清单|列表|排名|排行|每个|每一|各个|各境|分境界|逐境界|最强人物|人物境界/.test(text);
  const hasCollectionSubject = /飞剑|剑胚|剑匣|剑气|剑意|武器|法宝|道具|人物|角色|地点|势力|武夫|纯粹武夫|武道|修炼|境界|体系/.test(contextText);
  return asksForCollection && asksForManyItems && hasCollectionSubject
    ? uniqueCompact(hits, 4).join(" / ")
    : "";
}

function isExplicitSingleTargetL2Query(text) {
  const hasSpecificTarget = /武夫第[一二三四五六七八九十\d]+境|第[一二三四五六七八九十\d]+境|远游境|山巅境|止境|气盛|归真|神到/.test(text);
  if (!hasSpecificTarget) return false;
  const hasRankingOrGrouping = /每个|每一|各个|各境|分境界|逐境界|排名|排行|top\s*\d+|前\s*\d+|取前|取\d+|前三|前五|最强/.test(text);
  return !hasRankingOrGrouping && /总结|查询|查找|关于|全部|全部事实|相关事实/.test(text);
}

function buildL2QueryIntentRecallTerms(query, indexGroups = [], { collectionMode = false } = {}) {
  const contextText = [
    query,
    ...(indexGroups || []).flatMap((group) => [
      group?.name,
      group?.description,
      group?.l2_index_prompt
    ])
  ].filter(Boolean).join(" ");
  const terms = [];
  if (/武夫|纯粹武夫|武道|修炼|境界|体系|山巅境|远游境|止境/.test(contextText)) {
    terms.push(
      "cultivation",
      "武夫",
      "纯粹武夫",
      "武道",
      "境界",
      "境界体系",
      "修炼",
      "山巅境",
      "远游境",
      "止境",
      "十境",
      "九境",
      "八境",
      "七境"
    );
  }
  if (collectionMode && /人物|角色|最强|前三|排名|排行|代表/.test(contextText)) {
    terms.push("代表人物", "人物");
  }
  return uniqueCompact(terms.map(cleanupL2QueryTerm).filter(Boolean), 32);
}

function extractL2QueryTerms(query, target = "") {
  const text = String(query || "");
  const terms = [];
  if (target) terms.push(target);
  terms.push(...inferEntityQueriesFromPrompt(text));
  for (const match of text.matchAll(/[《“「『‘（(]([^》”」』’）)]{1,24})[》”」』’）)]/g)) {
    terms.push(match[1]);
  }
  for (const segment of text.split(/[，。；;、\s\n\r:：/｜|]+/)) {
    const cleaned = cleanupL2QueryTerm(segment);
    if (cleaned) terms.push(cleaned);
    for (const token of l2QuerySubTerms(cleaned)) terms.push(token);
  }
  return uniqueCompact(terms.map(cleanupL2QueryTerm).filter(Boolean), 48);
}

function cleanupL2QueryTerm(value) {
  let text = String(value || "").trim();
  text = text.replace(/^(帮我|请|查询|查找|整理|总结|输出|关于|围绕|直接|内容|结果|相关|事实|章节|原文中?|称之为|称为|早期|后期)+/g, "");
  text = text.replace(/(内容|结果|相关事实|事实清单|时间线|设定集|对应章节|输出要求|模式)$/g, "");
  text = text.trim();
  if (!text || text.length < 2 || text.length > 18) return "";
  if (/^(剑来|l2|json|markdown|事实|章节|内容|整理|总结|查询|查找|时间线|外形演化|输出|需要有人名|有人名|人名|人物介绍|人物简介|介绍|为什么重要)$|^\d+$/.test(text.toLowerCase())) return "";
  if (/^(最强人物|人物境界|武夫每个境界|每个境界|取前三|前三)$/.test(text)) return "";
  return text;
}

function l2QuerySubTerms(value) {
  const text = String(value || "");
  const terms = new Set();
  for (const match of text.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{2,8}/g)) {
    const word = match[0];
    if (/初一|十五|小酆都|银锭|白虹|剑胚|飞剑|外形|形态|炼化|来历|战绩|神通|持有|名字|别名|称呼|武夫|武道|境界|修炼|山巅境|远游境|止境|十境|九境|八境|七境/.test(word)) {
      terms.add(word);
    }
  }
  for (const keyword of ["初一", "十五", "小酆都", "银锭", "小银锭", "白虹", "小小白虹", "剑胚", "飞剑", "外形", "形态", "武夫", "纯粹武夫", "武道", "境界", "境界体系", "修炼", "山巅境", "远游境", "止境", "十境", "九境", "八境", "七境", "代表人物"]) {
    if (text.includes(keyword)) terms.add(keyword);
  }
  return [...terms];
}

function expandL2QueryTerms(facts, baseTerms) {
  const base = new Set(baseTerms.map(normalizeRouteToken));
  const terms = [];
  for (const fact of facts || []) {
    terms.push(
      fact?.entity,
      fact?.fact_type,
      ...(Array.isArray(fact?.aliases) ? fact.aliases : []),
      ...(Array.isArray(fact?.tags) ? fact.tags : []),
      ...(Array.isArray(fact?.related_entities) ? fact.related_entities : [])
    );
    const text = [fact?.fact, ...(Array.isArray(fact?.evidence) ? fact.evidence : [])].join(" ");
    for (const match of text.matchAll(/[“「『‘]([^”」』’]{1,12})[”」』’]/g)) {
      terms.push(match[1]);
    }
    for (const keyword of ["小酆都", "银锭", "小银锭", "银块", "剑胚", "白虹", "小小的白虹", "晶莹剔透", "纤小"]) {
      if (text.includes(keyword)) terms.push(keyword);
    }
  }
  return uniqueCompact(terms
    .map(cleanupL2QueryTerm)
    .filter((term) => term && !base.has(normalizeRouteToken(term))), 32);
}

function l2QueryFactSearchText(fact) {
  return [
    fact?.category,
    fact?.entity,
    fact?.fact_type,
    fact?.fact,
    ...(Array.isArray(fact?.aliases) ? fact.aliases : []),
    ...(Array.isArray(fact?.tags) ? fact.tags : []),
    ...(Array.isArray(fact?.related_entities) ? fact.related_entities : []),
    ...(Array.isArray(fact?.evidence) ? fact.evidence : [])
  ].map(normalizeRouteToken).join(" ");
}

function shouldFallbackL2Recall(facts, entityQueries, usedL1Route = false) {
  if (usedL1Route) return false;
  if (!entityQueries.length) return false;
  return facts.length < 30 || new Set(facts.map((fact) => fact.chapter_index)).size < 8;
}

function shouldRetryL2RecallWithoutCategories({ initialFacts, categories, entityQueries }) {
  if (!Array.isArray(categories) || !categories.length) return false;
  if (!Array.isArray(entityQueries) || !entityQueries.length) return false;
  return !Array.isArray(initialFacts) || !initialFacts.length;
}

function resolveAnalysisIndexGroups({ bookId, settings = {}, promptGroup = null }) {
  const groups = listBookIndexGroups(bookId);
  const byKey = new Map(groups.map((group) => [group.group_key, group]));
  const explicitKeys = normalizeIndexGroupKeysForWorkflow(promptGroup?.index_group_keys || settings.index_group_keys || [])
    .filter((key) => key !== "base");
  if (!explicitKeys.length) {
    const enabledGroups = groups.filter((group) => group.enabled);
    const nonBaseEnabled = enabledGroups.filter((group) => group.group_key !== "base");
    if (nonBaseEnabled.length) return nonBaseEnabled;
    return enabledGroups;
  }
  const missing = explicitKeys.filter((key) => !byKey.has(key));
  if (missing.length) {
    const error = new Error(`分析模板绑定的事实索引不存在或已禁用：${missing.join("、")}`);
    error.status = 422;
    throw error;
  }
  return explicitKeys.map((key) => byKey.get(key)).filter(Boolean);
}

function normalizeIndexGroupKeysForWorkflow(value) {
  const raw = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
  return [...new Set(raw
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .map(normalizeIndexGroupKey)
    .filter(Boolean))];
}

function countBy(items, key) {
  const counts = {};
  for (const item of items || []) {
    const value = String(item?.[key] || "").trim() || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

async function reusableAnalysisChapter({ analysisId, chapter, promptHash, model }) {
  const existing = getAnalysisChapterMetadata(analysisId, chapter.chapter_index);
  if (!existing || existing.status !== "completed") return null;
  if (!existing.has_result) return null;
  if (existing.content_hmac !== chapter.content_hmac) return null;
  if (existing.prompt_hash !== promptHash) return null;
  if (existing.model !== model) return null;
  return decryptAnalysisChapterResult(analysisId, chapter.chapter_index);
}

async function ensureAnalysisProviderReady(provider) {
  if (provider === "dify") {
    await testDifyConnection({ target: "analysis_chapter" });
    await testDifyConnection({ target: "analysis_summary" });
    return;
  }
  await testOpenAIConnection();
}

async function ensureAnalysisSummaryProviderReady(provider) {
  if (provider === "dify") {
    await testDifyConnection({ target: "analysis_summary" });
    return;
  }
  await testOpenAIConnection();
}

async function callAnalysisJson({
  provider = "openai",
  target = "analysis_summary",
  model,
  reasoningEffort,
  instructions,
  input,
  schema,
  schemaName = "result",
  maxOutputTokens,
  strict = true,
  errorLabel = "Dify 分析工作流"
}) {
  if (provider === "dify") {
    const outputs = await runDifyWorkflow({
      target,
      apiKey: target === "analysis_chapter" ? config.dify.analysisChapterWorkflowApiKey : config.dify.analysisSummaryWorkflowApiKey,
      inputs: {
        task_type: target === "analysis_chapter" ? "chapter" : "summary",
        prompt: String(instructions || ""),
        model: String(model || ""),
        reasoning_effort: String(reasoningEffort || ""),
        schema_name: String(schemaName || "result"),
        schema_json: JSON.stringify(schema || {}),
        strict_json_schema: String(Boolean(strict)),
        max_output_tokens: Number.isFinite(Number(maxOutputTokens)) ? String(Number(maxOutputTokens)) : "",
        context_json: JSON.stringify(input || [])
      }
    });
    return {
      value: normalizeDifyAnalysisJsonOutput(outputs, schema || null, { errorLabel }),
      responseId: outputs.response_id || outputs.responseId || null
    };
  }
  return callOpenAIJson({
    model,
    reasoningEffort,
    instructions,
    input,
    schema,
    schemaName,
    maxOutputTokens,
    strict
  });
}

async function callAnalysisText({
  provider = "openai",
  target = "analysis_summary",
  model,
  reasoningEffort,
  instructions,
  input,
  maxOutputTokens,
  errorLabel = "Dify 分析工作流"
}) {
  if (provider === "dify") {
    const outputs = await runDifyWorkflow({
      target,
      apiKey: target === "analysis_chapter" ? config.dify.analysisChapterWorkflowApiKey : config.dify.analysisSummaryWorkflowApiKey,
      inputs: {
        task_type: target === "analysis_chapter" ? "chapter" : "summary",
        prompt: String(instructions || ""),
        model: String(model || ""),
        reasoning_effort: String(reasoningEffort || ""),
        max_output_tokens: Number.isFinite(Number(maxOutputTokens)) ? String(Number(maxOutputTokens)) : "",
        context_json: JSON.stringify(input || [])
      }
    });
    return {
      value: normalizeDifyAnalysisTextOutput(outputs, { errorLabel }),
      responseId: outputs.response_id || outputs.responseId || null
    };
  }
  return callOpenAIText({
    model,
    reasoningEffort,
    instructions,
    input,
    maxOutputTokens
  });
}

async function summarizeAnalysisResults({
  analysisId,
  task,
  analysisContext = {},
  model,
  requestModel = model,
  reasoningEffort,
  analysisProvider = "openai",
  chapterResults,
  failedChapters,
  userPrompt,
  outputSchema,
  sourceChapterCount
}) {
  const finalSchema = deriveFinalSummarySchema({
    userPrompt,
    configuredSchema: parseOutputSchemaOrNull(outputSchema)
  });
  const rawSummaryLength = summaryRawMaterialLength({ chapterResults, failedChapters, userPrompt });
  const directTargetChars = finalSchema?.schema ? 12_000 : SUMMARY_COMPACT_TARGET_CHARS;
  const compactDirectResults = compactChapterResultsForSummary({
    chapterResults,
    failedChapters,
    userPrompt,
    targetChars: directTargetChars
  });
  if (shouldSplitCustomFinalSummary(finalSchema) && rawSummaryLength > SUMMARY_PART_INPUT_MAX_CHARS) {
    await waitIfPaused(task);
    updateTask(task, {
      progress: { ...task.progress, current: "GPT 分字段汇总" },
      message: "正在按字段拆分最终汇总"
    });
    return runCustomFieldSummaryCalls({
      analysisId,
      task,
      analysisContext,
      model,
      requestModel,
      reasoningEffort: "low",
      analysisProvider,
      userPrompt,
      sourceMaterial: {
        compressedResults: compactDirectResults,
        failedChapters
      },
      materialLabel: "逐章理解素材",
      schema: finalSchema,
      sourceChapterCount
    });
  }
  const directPrepared = prepareEvidenceSourceMaterial({
    sourceMaterial: {
      compressedResults: compactDirectResults,
      failedChapters
    },
    fieldName: "final",
    fieldSchema: finalSchema?.schema || null,
    userPrompt,
    materialLabel: "逐章理解素材",
    budget: SUMMARY_PART_INPUT_MAX_CHARS
  });
  const directInput = buildEvidenceSummaryInput({
    userPrompt,
    sourceMaterial: directPrepared.material,
    materialLabel: "逐章理解素材",
    contextLabel: "最终汇总"
  });
  if (inputTextLength(directInput) <= SUMMARY_PART_INPUT_MAX_CHARS) {
    return runFinalSummaryCall({
      analysisId,
      task,
      partKey: finalSchema?.schema ? "json.final.merge" : "text.final.merge",
      stageLabel: "GPT 汇总分析结果",
      model,
      requestModel,
      reasoningEffort,
      analysisProvider,
      userPrompt,
      input: directInput,
      schema: finalSchema,
      sourceChapterCount,
      traceSummary: sourceTraceFromMaterial({
        partKey: finalSchema?.schema ? "json.final.merge" : "text.final.merge",
        stage: finalSchema?.schema ? "json_final_merge" : "text_final_merge",
        fieldName: "final",
        material: directPrepared.material
      })
    });
  }

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "本地整理汇总素材" },
    message: "正在本地整理长输入汇总素材"
  });
  const compressedResults = compactChapterResultsForSummary({
    chapterResults,
    failedChapters,
    userPrompt,
    targetChars: finalSchema?.schema ? 12_000 : SUMMARY_COMPACT_TARGET_CHARS
  });

  await waitIfPaused(task);
  updateTask(task, {
    progress: { ...task.progress, current: "GPT 汇总压缩结果" },
    message: "正在基于压缩素材生成最终汇总"
  });
  if (shouldSplitCustomFinalSummary(finalSchema)) {
    return runCustomFieldSummaryCalls({
      analysisId,
      task,
      analysisContext,
      model,
      requestModel,
      reasoningEffort: "low",
      analysisProvider,
      userPrompt,
      sourceMaterial: {
        compressedResults,
        failedChapters
      },
      materialLabel: "压缩摘要素材",
      schema: finalSchema,
      sourceChapterCount
    });
  }
  const compressedPrepared = prepareEvidenceSourceMaterial({
    sourceMaterial: {
      compressedResults,
      failedChapters
    },
    fieldName: "final",
    fieldSchema: finalSchema?.schema || null,
    userPrompt,
    materialLabel: "压缩摘要素材",
    budget: SUMMARY_PART_INPUT_MAX_CHARS
  });
  const compressedInput = buildEvidenceSummaryInput({
    userPrompt,
    sourceMaterial: compressedPrepared.material,
    materialLabel: "压缩摘要素材",
    contextLabel: "最终汇总"
  });
  return runFinalSummaryCall({
    analysisId,
    task,
    partKey: finalSchema?.schema ? "json.final.merge" : "text.final.merge",
    stageLabel: "GPT 汇总压缩结果",
    model,
    requestModel,
    reasoningEffort: "low",
    analysisProvider,
    userPrompt,
    input: compressedInput,
    schema: finalSchema,
    sourceChapterCount,
    traceSummary: sourceTraceFromMaterial({
      partKey: finalSchema?.schema ? "json.final.merge" : "text.final.merge",
      stage: finalSchema?.schema ? "json_final_merge" : "text_final_merge",
      fieldName: "final",
      material: compressedPrepared.material
    })
  });
}

function summaryRawMaterialLength({ chapterResults, failedChapters, userPrompt }) {
  return String(userPrompt || "").length
    + JSON.stringify(chapterResults || []).length
    + JSON.stringify(failedChapters || []).length;
}

async function runFinalSummaryCall({
  analysisId,
  task,
  partKey,
  stageLabel,
  model,
  requestModel = model,
  reasoningEffort,
  analysisProvider = "openai",
  userPrompt = "",
  input,
  schema,
  sourceChapterCount,
  traceSummary = null,
  errorLabel = "Dify 分析工作流"
}) {
  assertSummaryInputWithinBudget(input, stageLabel);
  const contentHash = summaryContentHash({ input, schema: schema?.schema || null, userPrompt });
  const basePart = {
    analysisId,
    partKey: partKey || (schema?.schema ? "json.final.merge" : "text.final.merge"),
    parentKey: "",
    stage: schema?.schema ? "json_final_merge" : "text_final_merge",
    contentHash,
    promptHash: shaString(userPrompt || ""),
    schemaHash: shaString(schema?.schema ? JSON.stringify(schema.schema) : ""),
    model,
    reasoningEffort,
    inputSummary: `${stageLabel} · 输入 ${inputTextLength(input)} 字`,
    traceSummary
  };
  if (schema?.schema) {
    return runPersistedSummaryNode(task, basePart, async () => {
      const response = await callAnalysisJson({
        provider: analysisProvider,
        target: "analysis_summary",
        model: requestModel,
        reasoningEffort,
        instructions: [
          "你是严谨的小说多章节汇总引擎。按用户汇总 Prompt 输出最终结果；如果用户要求 JSON，则只输出合法 JSON，否则直接输出文本，不要添加无关解释。",
          schema?.unwrapField ? `结构化输出时请先用 ${schema.unwrapField} 字段承载用户要求的数组，系统保存前会自动解包为用户要求的数组。` : ""
        ].filter(Boolean).join("\n"),
        input,
        schema: schema.schema,
        schemaName: schema.schemaName,
        maxOutputTokens: SUMMARY_FINAL_MAX_OUTPUT_TOKENS,
        strict: schema.strict,
        errorLabel
      });
      const finalValue = normalizeFinalSchemaValue(response.value, schema);
      assertFinalSummaryUseful(parseJsonOrText(finalValue), sourceChapterCount, {
        schema: schema.schema,
        schemaName: schema.schemaName,
        userPrompt
      });
      return { ...response, value: finalValue };
    });
  }
  return runPersistedSummaryNode(task, basePart, async () => {
    const response = await callAnalysisText({
      provider: analysisProvider,
      target: "analysis_summary",
      model: requestModel,
      reasoningEffort,
      instructions: "你是严谨的小说多章节汇总引擎。按用户汇总 Prompt 输出最终结果；如果用户要求 JSON，则只输出合法 JSON，否则直接输出文本，不要添加无关解释。",
      input,
      maxOutputTokens: SUMMARY_FINAL_MAX_OUTPUT_TOKENS,
      errorLabel
    });
    assertFinalSummaryUseful(parseJsonOrText(response.value), sourceChapterCount, {
      schema: schema?.schema || null,
      schemaName: schema?.schemaName || "",
      userPrompt
    });
    return response;
  });
}

function shouldSplitCustomFinalSummary(schema) {
  if (schema?.schemaName !== "custom_final_analysis") return false;
  if (schema?.unwrapField) return false;
  const properties = schema.schema?.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  return Object.keys(properties).length >= 2;
}

function normalizeFinalSchemaValue(value, schemaConfig) {
  const unwrapField = schemaConfig?.unwrapField;
  if (!unwrapField) return value;
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value[unwrapField])) {
    return value[unwrapField];
  }
  return value;
}

async function runCustomFieldSummaryCalls({
  analysisId,
  task,
  analysisContext = {},
  model,
  requestModel = model,
  reasoningEffort,
  analysisProvider = "openai",
  userPrompt,
  sourceMaterial,
  materialLabel,
  schema,
  sourceChapterCount
}) {
  const properties = schema.schema.properties || {};
  const finalValue = {};
  const responseIds = [];
  const fieldNames = Object.keys(properties);
  const primaryContentFieldCount = fieldNames
    .filter((fieldName) => isPotentialPrimaryContentField(fieldName, properties[fieldName]))
    .length;
  const targetContext = sourceMaterial?.targetContext || buildTargetContext({
    userPrompt,
    schema: schema.schema
  });

  for (const fieldName of fieldNames) {
    const deterministicValue = deterministicFinalFieldValue(fieldName, analysisContext, {
      userPrompt,
      fieldSchema: properties[fieldName]
    });
    if (deterministicValue !== undefined) {
      await saveAnalysisSummaryPart({
        analysisId,
        partKey: `meta.${fieldName}`,
        stage: "meta",
        status: "completed",
        contentHash: summaryContentHash({ fieldName, value: deterministicValue }),
        promptHash: shaString(userPrompt || ""),
        schemaHash: shaString(JSON.stringify(properties[fieldName] || {})),
        model,
        reasoningEffort,
        inputSummary: `元信息字段 ${fieldName}`,
        result: { [fieldName]: deterministicValue }
      });
      finalValue[fieldName] = deterministicValue;
      continue;
    }
    await waitIfPaused(task);
    updateTask(task, {
      progress: { ...task.progress, current: `GPT 分字段汇总 ${fieldName}` },
      message: `正在生成最终 JSON 字段：${fieldName}`
    });

    const fieldSchema = buildSingleFieldSummarySchema({
      fieldName,
      fieldSchema: properties[fieldName]
    });
    const fieldResult = await runJsonFieldSummaryParts({
      analysisId,
      task,
      model,
      requestModel,
      reasoningEffort,
      analysisProvider,
      userPrompt,
      sourceMaterial: scopedSourceMaterialForField({ sourceMaterial, fieldName, fieldSchema: properties[fieldName], userPrompt, targetContext }),
      materialLabel,
      fieldName,
      fieldSchema: properties[fieldName],
      wrapperSchema: fieldSchema,
      sourceChapterCount,
      primaryContentFieldCount,
      targetContext
    });

    finalValue[fieldName] = fieldResult.value;
    if (fieldResult.responseId) responseIds.push(fieldResult.responseId);
  }

  assertFinalSummaryUseful(finalValue, sourceChapterCount, {
    schema: schema.schema,
    schemaName: schema.schemaName,
    userPrompt
  });
  await saveAnalysisSummaryPart({
    analysisId,
    partKey: "json.final.merge",
    stage: "json_final_merge",
    status: "completed",
    contentHash: summaryContentHash(finalValue),
    promptHash: shaString(userPrompt || ""),
    schemaHash: shaString(JSON.stringify(schema.schema || {})),
    model,
    reasoningEffort,
    inputSummary: `最终 JSON 合并 · ${fieldNames.length} 字段`,
    traceSummary: mergeSourceTraces(listAnalysisSummaryPartMetadata(analysisId)
      .filter((part) => part.stage === "json_field_batch")
      .map((part) => part.trace_summary), {
      partKey: "json.final.merge",
      stage: "json_final_merge",
      fieldName: "final",
      targetSubject: targetContext.subject
    }),
    result: finalValue
  });
  return {
    value: finalValue,
    responseId: responseIds.join(",") || null
  };
}

function deterministicFinalFieldValue(fieldName, analysisContext = {}, options = {}) {
  if (fieldName === "book_id") return analysisContext.bookId || "";
  if (fieldName === "book_name") return analysisContext.bookName || "";
  if (fieldName === "task") return analysisContext.taskName || "";
  const promptTemplateValue = promptJsonTemplateFieldValue(options.userPrompt, fieldName);
  if (promptTemplateValue !== undefined && isDeterministicTemplateField(fieldName, options.fieldSchema, promptTemplateValue)) {
    if (isTemplatePlaceholderText(promptTemplateValue) && isAnalysisParameterField(fieldName, options.fieldSchema)) {
      const inferred = inferAnalysisParameterValue(fieldName, options.userPrompt, analysisContext);
      assertAnalysisParameterReady(fieldName, inferred);
      return inferred;
    }
    assertTemplateFieldReady(fieldName, promptTemplateValue);
    return promptTemplateValue;
  }
  if (isAnalysisParameterField(fieldName, options.fieldSchema)) {
    const inferred = inferAnalysisParameterValue(fieldName, options.userPrompt, analysisContext);
    assertAnalysisParameterReady(fieldName, inferred);
    return inferred;
  }
  return undefined;
}

function promptJsonTemplateFieldValue(userPrompt, fieldName) {
  const template = extractLastJsonObjectTemplate(userPrompt);
  if (!template || !Object.hasOwn(template, fieldName)) return undefined;
  return template[fieldName];
}

function isDeterministicTemplateField(fieldName, fieldSchema, templateValue) {
  if (!isScalarFieldSchema(fieldSchema)) return false;
  if (typeof templateValue !== "string") return true;
  const trimmed = templateValue.trim();
  if (!trimmed) return true;
  if (isAnalysisParameterField(fieldName, fieldSchema)) return true;
  if (isTemplatePlaceholderText(trimmed)) return false;
  return isMetadataLikeFieldName(fieldName);
}

function isAnalysisParameterField(fieldName, fieldSchema) {
  if (!isScalarFieldSchema(fieldSchema)) return false;
  return /^(target|target_subject|subject|analysis_subject|analysis_goal|task_goal|scope|range|stage|phase|period|era|context|dimension|dimensions|目标主体|分析主体|分析目标|任务目标|范围|分析范围|阶段|时期|时代|上下文|维度)$/i.test(String(fieldName || ""));
}

function isMetadataLikeFieldName(fieldName) {
  return /^(version|schema_version|language|locale|format|output_format|analysis_mode|mode|source|source_type|stage|phase|period|era)$/i.test(String(fieldName || ""));
}

function isScalarFieldSchema(schema) {
  if (!schema) return true;
  if (schema.type === "array" || schema.type === "object") return false;
  if (schema.anyOf) return schema.anyOf.every(isScalarFieldSchema);
  return true;
}

function inferAnalysisParameterValue(fieldName, userPrompt, analysisContext = {}) {
  const fromTemplate = promptJsonTemplateFieldValue(userPrompt, fieldName);
  if (fromTemplate !== undefined && !isTemplatePlaceholderText(fromTemplate)) return fromTemplate;
  const prompt = String(userPrompt || "");
  const field = String(fieldName || "").toLowerCase();
  if (/target|subject|主体/.test(field)) return inferAnalysisTargetFromPrompt(prompt);
  const taskGoal = prompt.match(/(?:任务目标|分析目标)[：:]\s*([^\n。；]{2,80})/);
  if (/goal|目标/.test(field) && taskGoal) return taskGoal[1].trim();
  const scope = prompt.match(/(?:筛选范围|分析范围|范围)[：:]\s*([^\n。；]{2,80})/);
  if (/scope|range|范围/.test(field) && scope) return scope[1].trim();
  const stage = prompt.match(/(?:阶段|时期|stage|phase|period)[：:]\s*([^\n。；]{2,80})/i)
    || prompt.match(/[“"「『]([^”"」』]{1,60}(?:阶段|时期))[”"」』]/);
  if (/stage|phase|period|era|阶段|时期|时代/.test(field) && stage) return stage[1].trim();
  if (/task|goal|目标/.test(field)) return analysisContext.taskName || "";
  return "";
}

function inferAnalysisTargetFromPrompt(prompt) {
  const text = stripLastJsonObjectTemplate(prompt);
  const patterns = [
    /(?:目标主体|分析主体|指定主体|分析对象|分析目标|目标范围|目标类别|目标角色|核心角色)[^。；\n]{0,40}?[“"「『]([^”"」』]{1,60})[”"」』]/,
    /[“"「『]([^”"」』]{1,60})[”"」』][^。；\n]{0,24}?(?:为目标主体|为分析主体|作为目标主体|作为分析对象|作为分析目标|作为目标范围)/,
    /(?:目标主体|分析主体|指定主体|分析对象|分析目标|目标范围|目标类别|目标角色)[：:]\s*([^\n。；]{1,80})/,
    /(?:任务目标|分析目标)[：:]\s*(?:分析|梳理|整理|提炼|归纳)([^\n。；]{1,80})/,
    /(?:分析|梳理|整理|提炼|归纳)(?:小说中|全书中|本书中|这本书中|《[^》]+》中)?(?:的)?([^\n。；]{2,80})/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = normalizeAnalysisTargetCandidate(match?.[1]);
    if (value && !isTemplatePlaceholderText(value) && !isReservedTemplateToken(value)) return value;
  }
  return "";
}

function normalizeAnalysisTargetCandidate(value) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text
    .replace(/^(?:分析|梳理|整理|提炼|归纳|研究)\s*/, "")
    .replace(/^(?:小说中|全书中|本书中|这本书中|《[^》]+》中)?(?:的)?/, "")
    .replace(/(?:相关内容|相关资料|相关事实|资料|内容|信息|情况)$/g, "")
    .replace(/[，,、]\s*(?:并|以及|同时).+$/g, "")
    .trim();
  return text.slice(0, 80);
}

function buildTargetContext({ userPrompt, schema, sourceMaterial } = {}) {
  const template = extractLastJsonObjectTemplate(userPrompt);
  const candidates = [
    template?.target_item,
    template?.target_subject,
    template?.subject,
    template?.topic,
    inferL2QueryTargetSubject(userPrompt),
    sourceMaterial?.targetContext?.subject
  ];
  for (const candidate of candidates) {
    const subject = normalizeTargetSubject(candidate);
    if (subject) {
      return {
        subject,
        aliases: buildTargetAliases(subject),
        source: candidate === template?.target_item ? "template.target_item" : "prompt"
      };
    }
  }
  const schemaFields = schema?.properties ? Object.keys(schema.properties) : [];
  return { subject: "", aliases: [], source: schemaFields.length ? "schema" : "" };
}

function buildTargetAliases(subject) {
  const text = String(subject || "").trim();
  if (!text) return [];
  const aliases = [text];
  aliases.push(...splitTargetAliasText(text));
  const possessive = splitPossessiveTargetSubject(text);
  if (possessive?.object) {
    aliases.push(possessive.object);
    aliases.push(...splitTargetAliasText(possessive.object));
  }
  return uniqueCompact(aliases.map(normalizeTargetSubject).filter(Boolean), 8);
}

function splitTargetAliasText(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const normalized = text
    .replace(/（\s*(?:亦称|又称|别称|也称|简称)\s*([^）]{1,32})）/g, "/$1")
    .replace(/\(\s*(?:亦称|又称|别称|也称|简称)\s*([^)]{1,32})\)/g, "/$1");
  return normalized
    .split(/[/／|｜、，,；;]/)
    .map((entry) => entry.replace(/^(?:亦称|又称|别称|也称|简称)/, "").trim())
    .filter((entry) => entry && entry !== text);
}

function splitPossessiveTargetSubject(value) {
  const text = String(value || "").trim();
  const index = text.lastIndexOf("的");
  if (index <= 0 || index >= text.length - 1) return null;
  const owner = text.slice(0, index).trim();
  const object = text.slice(index + 1).trim();
  if (!owner || !object) return null;
  return { owner, object };
}

function inferL2QueryTargetSubject(prompt) {
  const text = String(prompt || "");
  if (isL2CollectionQuery(text)) return "";
  const quotedCandidates = [...text.matchAll(/[《“「『‘]([^》”」』’]{2,40})[》”」』’]/g)]
    .map((match) => normalizeTargetSubject(match[1]))
    .filter(Boolean);
  const slashQuoted = quotedCandidates.find((candidate) => splitTargetAliasText(candidate).length >= 2);
  if (slashQuoted) return slashQuoted;
  const quoted = quotedCandidates.find((candidate) => isLikelyL2TargetSubjectTerm(candidate));
  if (quoted) return quoted;
  const patternMatch = text.match(/(?:查询|查找|关于|围绕|聚焦|只看|输出|整理|总结)\s*([^\s，。；;、（）()]{2,12}?)(?:相关|这把|这件|的|事实|内容|外形|形态|时间线|形象|外貌|关系)/);
  const candidates = [
    patternMatch?.[1],
    ...extractL2QueryTerms(text).filter(isLikelyL2TargetSubjectTerm)
  ];
  for (const candidate of candidates) {
    const subject = normalizeTargetSubject(candidate);
    if (subject && isLikelyL2TargetSubjectTerm(subject)) return subject;
  }
  return "";
}

function isL2CollectionQuery(prompt) {
  return Boolean(l2QueryCollectionReason(prompt));
}

function isLikelyL2TargetSubjectTerm(value) {
  const text = normalizeRouteToken(value);
  if (!text || text.length < 2 || text.length > 12) return false;
  if (/提取|输出|总结|整理|包含|涉及|所有|清单|列表|名称|持有者|重要程度|前\d+|多少|最强|每个|各个|分境界|取前三|前三|人物境界|人物介绍|需要有人名/.test(text)) return false;
  if (/^(把|个|条|项|类)/.test(text)) return false;
  if (/以及|对应|章节|事实|内容|结果|要求|时间线|演化|外形|形态|来源|能力|战绩|设定|信息/.test(text)) return false;
  if (/^(l2|json|markdown|剑来|飞剑|本命飞剑|剑类|道具|重要道具|陈平安|章节)$/.test(text)) return false;
  return true;
}

function normalizeTargetSubject(value) {
  let text = normalizeAnalysisTargetCandidate(value);
  if (!text) return "";
  text = text
    .replace(/设定集|资料集|分析|专题|topic|target/gi, "")
    .replace(/^飞剑[·:：\s]*/, "")
    .replace(/[（）()[\]【】]/g, " ")
    .replace(/[《》“”「」『』‘’"']/g, " ")
    .trim();
  text = stripL2TargetDescriptorSuffix(text);
  if (!text || isTemplatePlaceholderText(text) || isReservedTemplateToken(text)) return "";
  if (text.length > 24 && /初一/.test(text)) return "初一";
  return text.slice(0, 24);
}

function stripL2TargetDescriptorSuffix(value) {
  let text = String(value || "").trim();
  for (let index = 0; index < 3; index += 1) {
    const next = text
      .replace(/(?:的)?(?:人物)?(?:形象特征|形象特点|形象描写|形象|外貌特征|外貌描写|外貌|外形特征|外形描写|外形|关系网|人物关系|关系|介绍|简介)$/g, "")
      .trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

function mergeEntityQueries(groups) {
  const output = [];
  const seen = new Set();
  for (const group of groups || []) {
    for (const value of group || []) {
      const normalized = normalizeEntityCandidate(value);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output.slice(0, 6);
}

function stripLastJsonObjectTemplate(value) {
  const text = String(value || "");
  const range = lastJsonObjectTemplateRange(text);
  if (!range) return text;
  return `${text.slice(0, range.start)}\n${text.slice(range.end + 1)}`;
}

function isReservedTemplateToken(value) {
  return /^(book_id|book_name|task|target_subject|summary|items|title|version|schema|json)$/i.test(String(value || "").trim());
}

function assertTemplateFieldReady(fieldName, value) {
  if (!isTemplatePlaceholderText(value)) return;
  const error = new Error(`分析 Prompt 的字段 ${fieldName} 仍是占位内容，请在 Prompt 管理中填写具体分析对象/目标范围，或删除该字段。`);
  error.status = 422;
  throw error;
}

function assertAnalysisParameterReady(fieldName, value) {
  if (String(value || "").trim() && !isTemplatePlaceholderText(value)) return;
  const error = new Error(`分析 Prompt 的字段 ${fieldName} 缺少具体分析对象/目标范围，请在 Prompt 管理中填写具体值或删除该字段。`);
  error.status = 422;
  throw error;
}

function isTemplatePlaceholderText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /用户指定|指定主体|目标主体|待填写|请填写|请输入|占位|placeholder|todo/i.test(text);
}

function buildSingleFieldSummarySchema({ fieldName, fieldSchema }) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      [fieldName]: fieldSchema || looseJsonValueSchema()
    },
    required: [fieldName]
  };
}

async function runJsonFieldSummaryParts({
  analysisId,
  task,
  model,
  requestModel = model,
  reasoningEffort,
  analysisProvider = "openai",
  userPrompt,
  sourceMaterial,
  materialLabel,
  fieldName,
  fieldSchema,
  wrapperSchema,
  sourceChapterCount,
  primaryContentFieldCount = 0,
  targetContext = null
}) {
  const chunks = splitSourceMaterialForField({
    sourceMaterial,
    fieldName,
    fieldSchema,
    userPrompt,
    materialLabel,
    targetContext
  });
  const batchValues = [];
  const responseIds = [];
  const reusableBatchValues = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const batchNumber = String(index + 1).padStart(3, "0");
    const partKey = chunks.length > 1
      ? `json.${fieldName}.batch.${batchNumber}`
      : `json.${fieldName}.merge`;
    const traceSummary = sourceTraceFromMaterial({
      partKey,
      parentKey: chunks.length > 1 ? `json.${fieldName}.merge` : "",
      stage: "json_field_batch",
      fieldName,
      material: chunk.material,
      promptOverheadChars: promptOverheadLength({ userPrompt, fieldName, fieldSchema, materialLabel, targetContext }),
      materialChars: JSON.stringify(chunk.material || {}).length
    });
    const requireNonEmpty = shouldRequireNonEmptyField({
      fieldName,
      fieldSchema,
      sourceMaterial: chunk.material,
      userPrompt,
      sourceChapterCount,
      primaryContentFieldCount
    });
    const fieldBatchMetadata = {
      analysisId,
      partKey,
      parentKey: chunks.length > 1 ? `json.${fieldName}.merge` : "",
      stage: "json_field_batch",
      contentHash: summaryContentHash({ fieldName, chunk, fieldSchema }),
      promptHash: shaString(userPrompt || ""),
      schemaHash: shaString(JSON.stringify(wrapperSchema || {})),
      model,
      reasoningEffort,
      inputSummary: `${fieldName} · ${chunk.label} · ${JSON.stringify(chunk.material).length} 字`,
      traceSummary
    };
    const reusable = await getReusableSummaryPart(fieldBatchMetadata);
    if (reusable) reusableBatchValues.push(reusable.value[fieldName]);
    updateTask(task, {
      progress: {
        ...task.progress,
        current: chunks.length > 1 ? `GPT 分字段汇总 ${fieldName} ${batchNumber}/${chunks.length}` : `GPT 分字段汇总 ${fieldName}`,
        summary_parts: await summaryProgressForAnalysis(analysisId)
      },
      message: chunks.length > 1
        ? `正在生成最终 JSON 字段：${fieldName}（${index + 1}/${chunks.length}）`
        : `正在生成最终 JSON 字段：${fieldName}`
    });
    const response = await runPersistedSummaryNode(task, fieldBatchMetadata, async () => {
      const input = buildCustomFieldSummaryInput({
        userPrompt,
        sourceMaterial: chunk.material,
        materialLabel,
        fieldName,
        fieldSchema,
        targetContext
      });
      assertSummaryInputWithinBudget(input, `${fieldName} · ${chunk.label}`);
      const result = await callAnalysisJson({
        provider: analysisProvider,
        target: "analysis_summary",
        model: requestModel,
        reasoningEffort,
        instructions: "你是严谨的小说多章节汇总引擎。当前只生成用户最终 JSON 模板中的一个顶层字段；只输出合法 JSON，不要添加无关解释。",
        input,
        schema: wrapperSchema,
        schemaName: safeSchemaName(`custom_field_${fieldName}`),
        maxOutputTokens: outputTokensForFieldSchema(fieldSchema),
        strict: false
      });
      assertFieldResponse(fieldName, fieldSchema, result.value, { requireNonEmpty });
      return result;
    });
    batchValues.push(response.value[fieldName]);
    if (response.responseId) responseIds.push(response.responseId);
  }

  if (chunks.length === 1) {
    const value = mergeFieldBatchValues(batchValues, fieldSchema, { fieldName, userPrompt });
    assertFieldValueUseful(fieldName, fieldSchema, value, sourceChapterCount, {
      requireNonEmpty: shouldRequireNonEmptyField({
        fieldName,
        fieldSchema,
        sourceMaterial,
        userPrompt,
        sourceChapterCount,
        primaryContentFieldCount
      })
    });
    return {
      value,
      responseId: responseIds.join(",") || null
    };
  }

  const existingMerge = await getReusableSummaryPart({
    analysisId,
    partKey: `json.${fieldName}.merge`,
    stage: "json_field_merge",
    contentHash: summaryContentHash({
      fieldName,
      mergeStrategyVersion: FIELD_BATCH_MERGE_STRATEGY_VERSION,
      batchValues: reusableBatchValues.length === chunks.length ? reusableBatchValues : batchValues
    }),
    promptHash: shaString(userPrompt || ""),
    schemaHash: shaString(JSON.stringify(fieldSchema || {})),
    model,
    reasoningEffort
  });
  if (existingMerge) {
    return {
      value: existingMerge.value[fieldName],
      responseId: responseIds.join(",") || null
    };
  }

  let mergedValue = mergeFieldBatchValues(batchValues, fieldSchema, { fieldName, userPrompt });
  const mergeDiagnostics = {
    fieldMergeMode: "recursive",
    fieldMergeBatchCount: chunks.length,
    fieldMergeModelUsed: false,
    fieldMergeFallbackReason: "",
    mergedValueChars: JSON.stringify(mergedValue || {}).length
  };
  if (shouldUseObjectFieldMergePolish({ fieldName, fieldSchema, targetContext, chunks })) {
    mergeDiagnostics.fieldMergeMode = "model_polish";
    const recursiveMergedValue = cloneJsonValue(mergedValue);
    const mergeInput = buildCustomFieldMergeInput({
      userPrompt,
      fieldName,
      fieldSchema,
      targetContext,
      batchValues,
      mergedValue: recursiveMergedValue
    });
    if (inputTextLength(mergeInput) <= SUMMARY_PART_INPUT_MAX_CHARS) {
      try {
        const polishResult = await callAnalysisJson({
          provider: analysisProvider,
          target: "analysis_summary",
          model: requestModel,
          reasoningEffort,
          instructions: "你是严谨的小说设定集分块合并器。只合并既有分块结果，不新增事实；不要用信息不足覆盖已有有效信息；只输出合法 JSON。",
          input: mergeInput,
          schema: wrapperSchema,
          schemaName: safeSchemaName(`custom_field_merge_${fieldName}`),
          maxOutputTokens: outputTokensForFieldSchema(fieldSchema),
          strict: false
        });
        const polishValue = polishResult.value?.[fieldName];
        if (isObjectMergePolishUseful(polishValue, recursiveMergedValue)) {
          mergedValue = polishValue;
          mergeDiagnostics.fieldMergeModelUsed = true;
          if (polishResult.responseId) responseIds.push(polishResult.responseId);
        } else {
          mergeDiagnostics.fieldMergeFallbackReason = "model_merge_less_useful";
        }
      } catch (error) {
        mergeDiagnostics.fieldMergeFallbackReason = `model_merge_failed:${sanitizeText(error.message).slice(0, 80)}`;
      }
    } else {
      mergeDiagnostics.fieldMergeFallbackReason = "model_merge_input_over_budget";
    }
    mergeDiagnostics.mergedValueChars = JSON.stringify(mergedValue || {}).length;
  }
  assertFieldValueUseful(fieldName, fieldSchema, mergedValue, sourceChapterCount, {
    requireNonEmpty: shouldRequireNonEmptyField({
      fieldName,
      fieldSchema,
      sourceMaterial,
      userPrompt,
      sourceChapterCount,
      primaryContentFieldCount
    })
  });
  await saveAnalysisSummaryPart({
    analysisId,
    partKey: `json.${fieldName}.merge`,
    stage: "json_field_merge",
    status: "completed",
    contentHash: summaryContentHash({ fieldName, mergeStrategyVersion: FIELD_BATCH_MERGE_STRATEGY_VERSION, batchValues }),
    promptHash: shaString(userPrompt || ""),
    schemaHash: shaString(JSON.stringify(fieldSchema || {})),
    model,
    reasoningEffort,
    inputSummary: `${fieldName} · 合并 ${chunks.length} 个分块`,
    traceSummary: mergeSourceTraces(chunks.map((chunk, index) => sourceTraceFromMaterial({
      partKey: `json.${fieldName}.batch.${String(index + 1).padStart(3, "0")}`,
      parentKey: `json.${fieldName}.merge`,
      stage: "json_field_batch",
      fieldName,
      material: chunk.material,
      promptOverheadChars: promptOverheadLength({ userPrompt, fieldName, fieldSchema, materialLabel, targetContext }),
      materialChars: JSON.stringify(chunk.material || {}).length
    })), {
      partKey: `json.${fieldName}.merge`,
      stage: "json_field_merge",
      fieldName,
      targetSubject: targetContext?.subject || "",
      ...mergeDiagnostics
    }),
    result: { [fieldName]: mergedValue }
  });
  return {
    value: mergedValue,
    responseId: responseIds.join(",") || null
  };
}

function splitSourceMaterialForField({ sourceMaterial, fieldName, fieldSchema, userPrompt, materialLabel, targetContext = null }) {
  const base = sourceMaterial && typeof sourceMaterial === "object" ? sourceMaterial : {};
  const prepared = prepareEvidenceSourceMaterial({
    sourceMaterial: base,
    fieldName,
    fieldSchema,
    userPrompt,
    materialLabel,
    targetContext,
    budget: SUMMARY_PART_INPUT_MAX_CHARS
  });
  if (prepared.chunks.length <= 1) {
    return [{ label: `${fieldName} 全量素材`, material: prepared.material }];
  }
  return prepared.chunks.map((material, index) => ({
    label: `${fieldName} 分块 ${index + 1}/${prepared.chunks.length}`,
    material
  }));
}

function isLargeFieldSchema(schema) {
  if (!schema) return true;
  if (schema.type === "array") return true;
  if (schema.type === "object") return true;
  if (schema.anyOf) return schema.anyOf.some(isLargeFieldSchema);
  return false;
}

function outputTokensForFieldSchema(schema) {
  if (!schema) return CUSTOM_FIELD_SUMMARY_MAX_OUTPUT_TOKENS;
  if (schema.type === "array") return CUSTOM_FIELD_SUMMARY_MAX_OUTPUT_TOKENS;
  if (schema.type === "object") return CUSTOM_FIELD_SUMMARY_MAX_OUTPUT_TOKENS;
  return Math.min(1200, CUSTOM_FIELD_SUMMARY_MAX_OUTPUT_TOKENS);
}

function shouldRequireNonEmptyField({ fieldName, fieldSchema, sourceMaterial, userPrompt, sourceChapterCount = 0, primaryContentFieldCount = 0 }) {
  if (Number(sourceChapterCount || 0) < 3) return false;
  if (!materialHasEvidence(sourceMaterial)) return false;
  if (sourceMaterial?.sourceStats?.recalled_facts === 0 && !sourceMaterial?.sourceStats?.source_review_chapters) return false;
  if (isMetadataOnlyFieldName(fieldName)) return false;
  if (!isLargeFieldSchema(fieldSchema)) return false;
  const field = String(fieldName || "");
  if (!isRequiredPrimaryContentField(field)) return false;
  if (Number(primaryContentFieldCount || 0) > 1) return false;
  if (isOptionalSummaryFieldName(field)) {
    return false;
  }
  const prompt = String(userPrompt || "");
  if (new RegExp(`${escapeRegExp(field)}[^\\n。；]{0,80}(?:可为空|允许为空|没有则为空|没有则写空|没有则输出空)`, "i").test(prompt)) {
    return false;
  }
  return true;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSummaryInputWithinBudget(input, label) {
  const length = inputTextLength(input);
  if (length <= SUMMARY_PART_INPUT_MAX_CHARS) return;
  const error = new Error(`最终汇总分块输入超过预算：${label || "unknown"} ${length}/${SUMMARY_PART_INPUT_MAX_CHARS} 字。`);
  error.status = 502;
  throw error;
}

function assertFieldResponse(fieldName, fieldSchema, value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, fieldName)) {
    const error = new Error(`分字段汇总缺少字段：${fieldName}`);
    error.status = 502;
    throw error;
  }
  assertFieldValueUseful(fieldName, fieldSchema, value[fieldName], 3, options);
}

function assertFieldValueUseful(fieldName, fieldSchema, value, sourceChapterCount, options = {}) {
  if (sourceChapterCount < 3) return;
  if (fieldSchema?.type === "array") {
    if (!Array.isArray(value)) {
      const error = new Error(`分字段汇总字段 ${fieldName} 必须是数组。`);
      error.status = 502;
      throw error;
    }
    if (!value.length && options.requireNonEmpty) {
      throw emptyContentFieldError(fieldName);
    }
    return;
  }
  if (fieldSchema?.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      const error = new Error(`分字段汇总字段 ${fieldName} 必须是对象。`);
      error.status = 502;
      throw error;
    }
    if (options.requireNonEmpty && !isUsefulFinalValue(value)) {
      throw emptyContentFieldError(fieldName);
    }
    return;
  }
  if (typeof value === "string" && isPlaceholderText(value)) {
    const error = new Error(`分字段汇总字段 ${fieldName} 是占位内容。`);
    error.status = 502;
    throw error;
  }
}

function mergeFieldBatchValues(values, fieldSchema, options = {}) {
  if (fieldSchema?.type === "array") {
    const mergedByKey = new Map();
    const fallbackItems = [];
    const fallbackSeen = new Set();
    for (const value of values) {
      const items = Array.isArray(value) ? value : [];
      for (const item of items) {
        const subjectKey = arrayItemSubjectKey(item);
        if (!subjectKey) {
          const fallbackKey = stableStringify(item);
          if (fallbackSeen.has(fallbackKey)) continue;
          fallbackSeen.add(fallbackKey);
          fallbackItems.push(item);
          continue;
        }
        const existing = mergedByKey.get(subjectKey);
        mergedByKey.set(subjectKey, existing ? mergeArrayItems(existing, item, subjectKey) : cloneJsonValue(item));
      }
    }
    return applyArrayMergeConstraints([...mergedByKey.values(), ...fallbackItems], {
      userPrompt: options.userPrompt,
      fieldName: options.fieldName
    });
  }
  if (fieldSchema?.type === "object") {
    return mergeObjectBatchValues(values, fieldSchema, options);
  }
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? values[0] ?? "";
}

function mergeObjectBatchValues(values, fieldSchema, options = {}) {
  const objects = (values || []).filter(isPlainObject);
  let output = {};
  for (const value of objects) {
    output = mergeObjectValue(output, value, {
      fieldSchema,
      fieldKey: options.fieldName || "",
      subjectKey: normalizeArrayItemKey(value.name || value.title || options.fieldName || "")
    });
  }
  return output;
}

function mergeObjectValue(left, right, options = {}) {
  if (isEmptyOrPlaceholderValue(right)) return cloneJsonValue(left);
  if (isEmptyOrPlaceholderValue(left)) return cloneJsonValue(right);
  if (Array.isArray(left) || Array.isArray(right)) {
    const leftArray = Array.isArray(left) ? left : (isEmptyOrPlaceholderValue(left) ? [] : [left]);
    const rightArray = Array.isArray(right) ? right : (isEmptyOrPlaceholderValue(right) ? [] : [right]);
    return rightArray.length ? mergeJsonArrays(leftArray, rightArray) : cloneJsonValue(leftArray);
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const output = cloneJsonValue(left);
    const schemaProperties = options.fieldSchema?.properties || {};
    for (const [key, value] of Object.entries(right)) {
      if (isEmptyOrPlaceholderValue(value)) continue;
      if (!Object.hasOwn(output, key) || isEmptyOrPlaceholderValue(output[key])) {
        output[key] = cloneJsonValue(value);
        continue;
      }
      output[key] = mergeObjectValue(output[key], value, {
        fieldSchema: schemaProperties[key],
        fieldKey: key,
        subjectKey: options.subjectKey
      });
    }
    return output;
  }
  if (typeof left === "string" || typeof right === "string") {
    return mergeTextValue(left, right, {
      fieldKey: options.fieldKey,
      subjectKey: options.subjectKey
    });
  }
  if (typeof left === "number" && typeof right === "number") return Math.max(left, right);
  if (typeof left === "boolean" && typeof right === "boolean") return left || right;
  return cloneJsonValue(left);
}

function isEmptyOrPlaceholderValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return !value.trim() || isMergePlaceholderText(value) || isTemplatePlaceholderText(value);
  if (Array.isArray(value)) return !value.length;
  if (isPlainObject(value)) return Object.values(value).every(isEmptyOrPlaceholderValue);
  return false;
}

function isMergePlaceholderText(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;
  if (isPlaceholderText(normalized)) return true;
  return /^(信息不足|不详|未知|未提及|未明确|无明确信息|证据不足|暂无信息)$/.test(normalized);
}

function scoreObjectValueUsefulness(value) {
  if (isEmptyOrPlaceholderValue(value)) return 0;
  if (typeof value === "string") return Math.min(String(value).trim().length, 200);
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + scoreObjectValueUsefulness(item), 0) + value.length * 4;
  }
  if (isPlainObject(value)) {
    return Object.values(value).reduce((sum, item) => sum + scoreObjectValueUsefulness(item), 0)
      + Object.keys(value).length * 3;
  }
  return 0;
}

function isObjectMergePolishUseful(candidate, fallback) {
  if (!isPlainObject(candidate)) return false;
  if (hasObjectPlaceholderRegression(candidate, fallback)) return false;
  return scoreObjectValueUsefulness(candidate) >= scoreObjectValueUsefulness(fallback);
}

function hasObjectPlaceholderRegression(candidate, fallback) {
  if (isEmptyOrPlaceholderValue(fallback)) return false;
  if (isEmptyOrPlaceholderValue(candidate)) return true;
  if (Array.isArray(candidate) || Array.isArray(fallback)) {
    return Array.isArray(fallback) && fallback.length > 0 && (!Array.isArray(candidate) || candidate.length < fallback.length);
  }
  if (isPlainObject(candidate) && isPlainObject(fallback)) {
    return Object.entries(fallback).some(([key, value]) => hasObjectPlaceholderRegression(candidate[key], value));
  }
  return false;
}

function shouldUseObjectFieldMergePolish({ fieldName, fieldSchema, targetContext, chunks }) {
  return Boolean(
    targetContext?.subject
    && Array.isArray(chunks)
    && chunks.length > 1
    && fieldSchema?.type === "object"
    && isLargeFieldSchema(fieldSchema)
    && (isLargeFieldName(fieldName) || isPotentialPrimaryContentField(fieldName, fieldSchema))
  );
}

function arrayItemSubjectKey(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const entries = Object.entries(item);
  for (const preferred of ARRAY_ITEM_KEY_FIELDS) {
    const match = entries.find(([key, value]) => normalizeFieldKey(key) === preferred && usefulKeyValue(value));
    if (match) return normalizeArrayItemKey(match[1]);
  }
  for (const [key, value] of entries) {
    const normalized = normalizeFieldKey(key);
    if (!usefulKeyValue(value)) continue;
    if (/(^|_)(name|title|entity|subject|label)(_|$)/.test(normalized)) return normalizeArrayItemKey(value);
    if (/名称|名字|姓名|标题|主体|实体|对象/.test(String(key))) return normalizeArrayItemKey(value);
  }
  return "";
}

const ARRAY_ITEM_KEY_FIELDS = [
  "name",
  "title",
  "entity",
  "subject",
  "label",
  "character_name",
  "role_name",
  "item_name",
  "force_name",
  "faction_name",
  "system_name",
  "cultivation_name",
  "relationship_name",
  "角色名称",
  "角色名",
  "姓名",
  "名称",
  "名字",
  "物品名称",
  "势力名称",
  "宗门名称",
  "体系名称",
  "境界名称",
  "关系名称",
  "主体",
  "实体",
  "对象",
  "标题"
].map(normalizeFieldKey);

function usefulKeyValue(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value) || typeof value === "object") return false;
  const text = String(value).trim();
  return Boolean(text) && !isPlaceholderText(text) && !isTemplatePlaceholderText(text);
}

function normalizeArrayItemKey(value) {
  return normalizeRouteToken(value)
    .replace(/[“”"'`‘’「」『』《》（）()[\]{}<>]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function normalizeFieldKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function mergeArrayItems(left, right, subjectKey) {
  if (!left || typeof left !== "object" || Array.isArray(left)) return cloneJsonValue(right);
  if (!right || typeof right !== "object" || Array.isArray(right)) return cloneJsonValue(left);
  const output = cloneJsonValue(left);
  for (const [key, value] of Object.entries(right)) {
    if (value === undefined || value === null || value === "") continue;
    if (!Object.hasOwn(output, key) || output[key] === undefined || output[key] === null || output[key] === "" || isPlaceholderText(output[key])) {
      output[key] = cloneJsonValue(value);
      continue;
    }
    output[key] = mergeArrayItemValue(output[key], value, {
      fieldKey: key,
      subjectKey
    });
  }
  return output;
}

function mergeArrayItemValue(left, right, { fieldKey, subjectKey }) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return mergeJsonArrays(Array.isArray(left) ? left : [left], Array.isArray(right) ? right : [right]);
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    return mergeArrayItems(left, right, subjectKey);
  }
  if (typeof left === "string" || typeof right === "string") {
    return mergeTextValue(left, right, { fieldKey, subjectKey });
  }
  if (typeof left === "number" && typeof right === "number") return Math.max(left, right);
  if (typeof left === "boolean" && typeof right === "boolean") return left || right;
  return left;
}

function mergeJsonArrays(left, right) {
  const output = [];
  const seen = new Set();
  for (const item of [...left, ...right]) {
    const key = arrayItemSubjectKey(item) || stableStringify(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cloneJsonValue(item));
  }
  return output;
}

function mergeTextValue(left, right, { fieldKey, subjectKey }) {
  const leftText = String(left || "").trim();
  const rightText = String(right || "").trim();
  if (!leftText) return rightText;
  if (!rightText) return leftText;
  if (leftText === rightText) return leftText;
  if (normalizeArrayItemKey(leftText) === subjectKey) return leftText;
  if (normalizeArrayItemKey(rightText) === subjectKey) return leftText;
  if (isPlaceholderText(leftText) || isTemplatePlaceholderText(leftText)) return rightText;
  if (isPlaceholderText(rightText) || isTemplatePlaceholderText(rightText)) return leftText;
  if (leftText.includes(rightText)) return leftText;
  if (rightText.includes(leftText)) return rightText;
  if (isIdentityLikeField(fieldKey)) return leftText.length >= rightText.length ? leftText : rightText;
  return `${leftText}；${rightText}`;
}

function isIdentityLikeField(key) {
  return /^(name|title|entity|subject|label)$/i.test(String(key || ""))
    || /名称|名字|姓名|标题|主体|实体|对象/.test(String(key || ""));
}

function applyArrayMergeConstraints(items, { userPrompt, fieldName }) {
  const constraints = parseArrayMergeConstraints(userPrompt, fieldName);
  let output = items.map((item) => applyItemTextConstraints(item, constraints.textFieldLimits));
  if (constraints.labeledLimits.length) {
    output = applyLabeledItemLimits(output, constraints.labeledLimits);
  }
  if (constraints.maxItems && output.length > constraints.maxItems) {
    output = output.slice(0, constraints.maxItems);
  }
  return output;
}

function applyItemTextConstraints(item, limits) {
  if (!limits.length || !item || typeof item !== "object" || Array.isArray(item)) return item;
  const output = cloneJsonValue(item);
  for (const [key, value] of Object.entries(output)) {
    if (typeof value === "string") {
      const limit = textLimitForField(key, limits);
      if (limit) output[key] = clipText(value, limit);
    } else if (Array.isArray(value)) {
      output[key] = value.map((entry) => typeof entry === "string"
        ? clipText(entry, textLimitForField(key, limits) || entry.length)
        : entry);
    }
  }
  return output;
}

function applyLabeledItemLimits(items, labeledLimits) {
  const keptByLabel = new Map();
  const output = [];
  for (const item of items) {
    const text = arrayItemLabelText(item);
    const matched = labeledLimits.find((limit) => text.includes(limit.label));
    if (!matched) {
      output.push(item);
      continue;
    }
    const count = keptByLabel.get(matched.label) || 0;
    if (count >= matched.maxItems) continue;
    keptByLabel.set(matched.label, count + 1);
    output.push(item);
  }
  return output;
}

function arrayItemLabelText(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  return Object.values(item)
    .filter((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .map(normalizeRouteToken)
    .join(" ");
}

function textLimitForField(fieldKey, limits) {
  const normalized = normalizeFieldKey(fieldKey);
  const fieldText = normalizeRouteToken(fieldKey);
  const matched = limits
    .filter((limit) => {
      if (limit.field && normalized === limit.field) return true;
      if (limit.field && normalized.includes(limit.field)) return true;
      if (limit.label && fieldText.includes(limit.label)) return true;
      return limit.aliases.some((alias) => normalized.includes(alias) || fieldText.includes(alias));
    })
    .sort((left, right) => left.maxChars - right.maxChars)[0];
  return matched?.maxChars || 0;
}

function parseArrayMergeConstraints(userPrompt, fieldName) {
  const text = String(userPrompt || "");
  return {
    maxItems: parseGlobalArrayItemLimit(text, fieldName),
    labeledLimits: parseLabeledArrayItemLimits(text),
    textFieldLimits: parseTextFieldLimits(text)
  };
}

function parseGlobalArrayItemLimit(text, fieldName) {
  const normalizedField = normalizeFieldKey(fieldName);
  const candidates = [];
  const patterns = [
    /(?:最多|至多|不超过|上限|限制为|控制在)\s*([0-9一二两三四五六七八九十百〇零]+)\s*(?:个|条|项)/g,
    /(?:输出|保留|收录)[^。；\n]{0,12}?([0-9一二两三四五六七八九十百〇零]+)\s*(?:个|条|项)(?:以内|以下|之内)/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const number = parseLooseNumber(match[1]);
      if (!number) continue;
      const context = text.slice(Math.max(0, match.index - 24), Math.min(text.length, match.index + match[0].length + 24));
      if (/非核心|次要|每个|每条|每项/.test(context)) continue;
      const fieldRelevant = !normalizedField || normalizeRouteToken(context).includes(normalizeRouteToken(fieldName));
      candidates.push({ number, fieldRelevant });
    }
  }
  const relevant = candidates.filter((candidate) => candidate.fieldRelevant);
  const values = (relevant.length ? relevant : candidates).map((candidate) => candidate.number);
  return values.length ? Math.min(...values) : 0;
}

function parseLabeledArrayItemLimits(text) {
  const limits = [];
  const pattern = /([\u4e00-\u9fa5A-Za-z_]{2,16})[^。；\n]{0,12}?(?:最多|至多|不超过|上限|限制为|控制在)\s*([0-9一二两三四五六七八九十百〇零]+)\s*(?:个|条|项)/g;
  for (const match of text.matchAll(pattern)) {
    const label = normalizeRouteToken(match[1]);
    const maxItems = parseLooseNumber(match[2]);
    if (!label || !maxItems) continue;
    if (/字段|输出|结果|json|每个|每条|每项/.test(label)) continue;
    limits.push({ label, maxItems });
  }
  return limits;
}

function parseTextFieldLimits(text) {
  const limits = [];
  const pattern = /([A-Za-z_][A-Za-z0-9_]{1,40}|[\u4e00-\u9fa5]{2,12})[^。；\n]{0,20}?(?:控制在|不超过|最多|限制在|限制为)\s*([0-9一二两三四五六七八九十百〇零]+)\s*(?:字|字符)(?:以内|以下|之内)?/g;
  for (const match of text.matchAll(pattern)) {
    const rawField = normalizeLimitFieldCandidate(match[1]);
    const maxChars = parseLooseNumber(match[2]);
    if (!rawField || !maxChars) continue;
    limits.push({
      field: /^[A-Za-z_]/.test(rawField) ? normalizeFieldKey(rawField) : "",
      label: /^[A-Za-z_]/.test(rawField) ? "" : normalizeRouteToken(rawField),
      aliases: fieldLimitAliases(rawField),
      maxChars
    });
  }
  return limits;
}

function normalizeLimitFieldCandidate(value) {
  const text = String(value || "").trim();
  const ascii = text.match(/[A-Za-z_][A-Za-z0-9_]{1,40}/g);
  if (ascii?.length) return ascii.at(-1);
  const cjk = text.match(/[\u4e00-\u9fa5]{2,12}/g);
  return cjk?.at(-1) || text;
}

function fieldLimitAliases(field) {
  const normalized = normalizeRouteToken(field);
  const aliases = new Set([normalizeFieldKey(field), normalized]);
  if (/appearance|外貌|形象|描述/.test(normalized)) {
    aliases.add("appearance");
    aliases.add("外貌");
    aliases.add("形象");
    aliases.add("描述");
  }
  if (/identity|身份|定位/.test(normalized)) {
    aliases.add("identity");
    aliases.add("身份");
    aliases.add("定位");
  }
  if (/summary|note|说明|总结/.test(normalized)) {
    aliases.add("summary");
    aliases.add("note");
    aliases.add("说明");
    aliases.add("总结");
  }
  return [...aliases].filter(Boolean);
}

function parseLooseNumber(value) {
  const text = String(value || "").trim();
  const direct = Number(text);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  return parseChineseNumber(text);
}

function parseChineseNumber(text) {
  const chars = String(text || "").replace(/两/g, "二").replace(/〇/g, "零");
  if (!chars) return 0;
  const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if ([...chars].every((char) => Object.hasOwn(digits, char))) {
    return Number([...chars].map((char) => digits[char]).join(""));
  }
  if (chars.includes("百")) {
    const [head, tail = ""] = chars.split("百");
    return (digits[head] || 1) * 100 + parseChineseNumber(tail);
  }
  if (chars.includes("十")) {
    const [head, tail = ""] = chars.split("十");
    return (head ? digits[head] : 1) * 10 + (tail ? digits[tail] : 0);
  }
  return digits[chars] || 0;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

async function runPersistedSummaryNode(task, metadata, operation) {
  const existing = await getReusableSummaryPart(metadata);
  if (existing) {
    await saveAnalysisSummaryPart({
      ...metadata,
      status: "completed",
      result: existing
    });
    updateTask(task, {
      progress: {
        ...task.progress,
        current: `复用汇总分块 ${metadata.partKey}`,
        summary_parts: await summaryProgressForAnalysis(metadata.analysisId)
      },
      message: `复用已完成汇总分块：${metadata.partKey}`
    });
    return existing;
  }
  await saveAnalysisSummaryPart({
    ...metadata,
    status: "running"
  });
  try {
    const result = await runSummaryStageWithRetry(task, metadata.partKey, operation);
    await saveAnalysisSummaryPart({
      ...metadata,
      status: "completed",
      result
    });
    updateTask(task, {
      progress: {
        ...task.progress,
        summary_parts: await summaryProgressForAnalysis(metadata.analysisId)
      },
      message: `汇总分块完成：${metadata.partKey}`
    });
    return result;
  } catch (error) {
    await saveAnalysisSummaryPart({
      ...metadata,
      status: "failed",
      errorSummary: sanitizeText(error.message)
    });
    throw error;
  }
}

async function getReusableSummaryPart(metadata) {
  const existing = getAnalysisSummaryPartMetadata(metadata.analysisId, metadata.partKey);
  if (!existing || existing.status !== "completed" || !existing.has_result) return null;
  if (existing.content_hash !== metadata.contentHash) return null;
  if (existing.prompt_hash !== metadata.promptHash) return null;
  if (existing.schema_hash !== metadata.schemaHash) return null;
  if (existing.model !== metadata.model) return null;
  if (existing.reasoning_effort !== metadata.reasoningEffort) return null;
  return decryptAnalysisSummaryPartResult(metadata.analysisId, metadata.partKey);
}

async function summaryProgressForAnalysis(analysisId) {
  const parts = listAnalysisSummaryPartMetadata(analysisId);
  return {
    total: parts.length,
    completed: parts.filter((part) => part.status === "completed").length,
    failed: parts.filter((part) => part.status === "failed").length,
    running: parts.filter((part) => part.status === "running").length
  };
}

function summaryContentHash(value) {
  return shaString(stableStringify(value));
}

function shaString(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function scopedSourceMaterialForField({ sourceMaterial, fieldName, fieldSchema, userPrompt, targetContext = null }) {
  const material = sourceMaterial && typeof sourceMaterial === "object" ? sourceMaterial : {};
  const facts = Array.isArray(material.facts) ? material.facts : [];
  const reviewedChapters = Array.isArray(material.reviewedChapters) ? material.reviewedChapters : [];
  const compressedResults = Array.isArray(material.compressedResults) ? material.compressedResults : [];
  const field = String(fieldName || "").toLowerCase();
  const metadataOnly = isMetadataOnlyFieldName(fieldName);
  const categories = summaryFieldCategories(field);
  const entityQueries = field.includes("core") ? inferEntityQueriesFromPrompt(userPrompt || material.userPrompt || "", "") : [];
  const target = targetContext?.subject || "";
  const targetQueries = target ? [target] : [];
  const shouldUseTargetDossier = Boolean(target && !metadataOnly && isLargeFieldSchema(fieldSchema));
  const riskOnly = /uncertain|uncertainties|conflict|风险|不确定/.test(field);
  let scopedFacts = metadataOnly
    ? []
    : categories.length
      ? facts.filter((fact) => categories.includes(String(fact.category || "")))
      : facts;
  if (!metadataOnly && categories.length && !scopedFacts.length && facts.length) {
    scopedFacts = facts;
  }
  if (entityQueries.length) {
    const matched = scopedFacts.filter((fact) => factMatchesAnyEntity(fact, entityQueries));
    if (matched.length) scopedFacts = matched;
  }
  if (shouldUseTargetDossier) {
    const targetFacts = scopedFacts.filter((fact) => factMatchesAnyEntity(fact, targetQueries));
    if (targetFacts.length) scopedFacts = targetFacts;
  }
  if (riskOnly) {
    scopedFacts = facts.filter((fact) => {
      const confidence = Number(fact.confidence || 0);
      const text = factSearchText(fact);
      return confidence < 0.65 || /冲突|不确定|未知|缺失|矛盾|存疑|待确认/.test(text);
    });
  }

  const maxFacts = maxFactsForSummaryField(field);
  const compactFacts = scopedFacts
    .sort((left, right) => Number(right.importance || 0) * 2 + Number(right.confidence || 0)
      - (Number(left.importance || 0) * 2 + Number(left.confidence || 0)))
    .slice(0, maxFacts)
    .sort((left, right) => Number(left.chapter_index || 0) - Number(right.chapter_index || 0))
    .map(compactFactForFinalSummary);

  return {
    userPrompt: material.userPrompt,
    sourceStats: material.sourceStats,
    failedChapters: Array.isArray(material.failedChapters) ? material.failedChapters.slice(0, 120) : [],
    missingChapters: Array.isArray(material.missingChapters) ? material.missingChapters.slice(0, 120) : [],
    targetContext: targetContext || material.targetContext || null,
    compressedResults: metadataOnly ? [] : compressedResults,
    reviewedChapters: metadataOnly ? [] : reviewedChapters.map((chapter) => ({
      chapter_index: chapter.chapter_index,
      title: chapter.title,
      facts: (chapter.facts || [])
        .filter((fact) => !categories.length || categories.includes(String(fact.category || "")))
        .filter((fact) => !shouldUseTargetDossier || factMatchesAnyEntity(fact, targetQueries))
        .slice(0, 20)
        .map(compactFactForFinalSummary)
    })).filter((chapter) => chapter.facts.length),
    facts: compactFacts
  };
}

function isMetadataOnlyFieldName(fieldName) {
  return /^(book_id|book_name|task|title|version|schema_version|metadata|language|locale|format|output_format|analysis_mode|mode|source|source_type|stage|phase|period|era|阶段|时期|时代)$/i.test(String(fieldName || ""));
}

function prepareEvidenceSourceMaterial({ sourceMaterial, fieldName, fieldSchema, userPrompt, materialLabel, targetContext = null, budget }) {
  const base = sourceMaterial && typeof sourceMaterial === "object" ? sourceMaterial : {};
  const resolvedTargetContext = targetContext || base.targetContext || buildTargetContext({ userPrompt, sourceMaterial: base });
  const packets = buildEvidencePacketsForField({
    sourceMaterial: base,
    fieldName,
    fieldSchema,
    userPrompt,
    targetContext: resolvedTargetContext
  });
  const rankedPackets = rankEvidencePackets({
    packets,
    fieldName,
    fieldSchema,
    userPrompt
  });
  const baseMaterial = evidenceBaseMaterial({ sourceMaterial: base, fieldName, materialLabel, targetContext: resolvedTargetContext });
  const fullMaterial = {
    ...baseMaterial,
    sourceStats: {
      ...(baseMaterial.sourceStats || {}),
      evidence_packet_count: rankedPackets.length
    },
    target_evidence_count: rankedPackets.filter((packet) => packet.target_match).length,
    evidence_packets: rankedPackets
  };
  if (!rankedPackets.length && Array.isArray(base.compressedResults) && base.compressedResults.length) {
    return {
      material: fullMaterial,
      chunks: [fullMaterial]
    };
  }
  if (rankedPackets.length && rankedPackets.every((packet) => packet.source_type === "chapter_summary")) {
    const material = ensureEvidenceInputWithinBudget({
      material: fullMaterial,
      userPrompt,
      fieldName,
      fieldSchema,
      materialLabel,
      targetContext: resolvedTargetContext,
      budget,
      preserveCoverage: true
    });
    return {
      material,
      chunks: [material]
    };
  }
  if (fieldName === "final") {
    const material = ensureEvidenceInputWithinBudget({
      material: fullMaterial,
      userPrompt,
      fieldName,
      fieldSchema,
      materialLabel,
      targetContext: resolvedTargetContext,
      budget,
      preserveCoverage: true
    });
    return {
      material,
      chunks: [material]
    };
  }
  const forceChunk = isLargeFieldSchema(fieldSchema)
    && rankedPackets.length > 8
    && !rankedPackets.every((packet) => packet.source_type === "chapter_summary");
  if (!forceChunk && inputTextLength(buildCustomFieldSummaryInput({
    userPrompt,
    sourceMaterial: fullMaterial,
    materialLabel,
    fieldName,
    fieldSchema,
    targetContext: resolvedTargetContext
  })) <= budget) {
    return {
      material: fullMaterial,
      chunks: [fullMaterial]
    };
  }

  const chunks = splitEvidencePacketsIntoBudgetedChunks({
    baseMaterial,
    packets: rankedPackets,
    userPrompt,
    fieldName,
    fieldSchema,
    materialLabel,
    targetContext: resolvedTargetContext,
    budget
  });
  return {
    material: chunks[0] || fullMaterial,
    chunks: chunks.length ? chunks : [fullMaterial]
  };
}

function sourceTraceFromMaterial({ partKey, parentKey = "", stage, fieldName, material, promptOverheadChars = 0, materialChars = 0 }) {
  const safeMaterial = material && typeof material === "object" ? material : {};
  const packets = Array.isArray(safeMaterial.evidence_packets) ? safeMaterial.evidence_packets : [];
  const compressedResults = Array.isArray(safeMaterial.compressedResults) ? safeMaterial.compressedResults : [];
  const chapters = [...new Set(packets
    .map((packet) => Number(packet.chapter_index || 0))
    .filter((chapterIndex) => Number.isFinite(chapterIndex) && chapterIndex > 0))]
    .sort((left, right) => left - right);
  const subjects = uniqueCompact(packets.map((packet) => packet.subject), 12);
  const relatedSubjects = uniqueCompact(packets.flatMap((packet) => packet.related_subjects || []), 8);
  const sourceStats = safeMaterial.sourceStats && typeof safeMaterial.sourceStats === "object" ? safeMaterial.sourceStats : {};
  const targetSubject = String(safeMaterial.target_subject || safeMaterial.targetContext?.subject || "");
  const targetEvidenceCount = targetSubject
    ? packets.filter((packet) => packet.target_match || evidencePacketMatchesTarget(packet, targetSubject)).length
    : packets.filter((packet) => packet.target_match).length;
  return {
    part_key: String(partKey || ""),
    parent_key: String(parentKey || ""),
    stage: String(stage || ""),
    field_name: String(fieldName || safeMaterial.split?.fieldName || ""),
    batch: Number(safeMaterial.split?.batch || 1),
    total_batches: Number(safeMaterial.split?.total || 1),
    evidence_packet_count: packets.length,
    source_types: countValues(packets.map((packet) => packet.source_type || "unknown")),
    chapters: {
      count: chapters.length,
      min: chapters[0] || null,
      max: chapters[chapters.length - 1] || null,
      sample: compactChapterSample(chapters)
    },
    categories: countValues(packets.map((packet) => packet.category).filter(Boolean)),
    fact_types: countValues(packets.map((packet) => packet.fact_type).filter(Boolean)),
    subjects,
    related_subjects: relatedSubjects,
    target_subject: targetSubject,
    target_evidence_count: Number(safeMaterial.target_evidence_count || targetEvidenceCount || 0),
    field_material_mode: String(safeMaterial.split?.mode || "evidence_packets"),
    prompt_overhead_chars: Number(promptOverheadChars || 0),
    material_chars: Number(materialChars || JSON.stringify(safeMaterial).length || 0),
    compressed_results_count: compressedResults.length,
    trimmed_by_budget: Boolean(sourceStats.evidence_packets_trimmed_by_budget),
    omitted_by_budget: Number(sourceStats.evidence_packets_omitted_by_budget || 0)
  };
}

function mergeSourceTraces(traces, overrides = {}) {
  const normalized = (traces || []).filter((trace) => trace && typeof trace === "object");
  const chapters = new Set();
  const sourceTypes = new Map();
  const categories = new Map();
  const factTypes = new Map();
  const subjects = [];
  const relatedSubjects = [];
  let packetCount = 0;
  let compressedResultsCount = 0;
  let omittedByBudget = 0;
  let trimmedByBudget = false;
  let targetSubject = String(overrides.targetSubject || "");
  let targetEvidenceCount = 0;
  let promptOverheadChars = 0;
  let materialChars = 0;
  for (const trace of normalized) {
    packetCount += Number(trace.evidence_packet_count || 0);
    compressedResultsCount += Number(trace.compressed_results_count || 0);
    omittedByBudget += Number(trace.omitted_by_budget || 0);
    trimmedByBudget = trimmedByBudget || Boolean(trace.trimmed_by_budget);
    if (!targetSubject && trace.target_subject) targetSubject = String(trace.target_subject);
    targetEvidenceCount += Number(trace.target_evidence_count || 0);
    promptOverheadChars += Number(trace.prompt_overhead_chars || 0);
    materialChars += Number(trace.material_chars || 0);
    mergeCountMap(sourceTypes, trace.source_types);
    mergeCountMap(categories, trace.categories);
    mergeCountMap(factTypes, trace.fact_types);
    for (const chapterIndex of trace.chapters?.sample || []) {
      const number = Number(chapterIndex || 0);
      if (Number.isFinite(number) && number > 0) chapters.add(number);
    }
    if (trace.chapters?.min) chapters.add(Number(trace.chapters.min));
    if (trace.chapters?.max) chapters.add(Number(trace.chapters.max));
    subjects.push(...(Array.isArray(trace.subjects) ? trace.subjects : []));
    relatedSubjects.push(...(Array.isArray(trace.related_subjects) ? trace.related_subjects : []));
  }
  const chapterList = [...chapters].filter(Boolean).sort((left, right) => left - right);
  return {
    part_key: String(overrides.partKey || ""),
    parent_key: String(overrides.parentKey || ""),
    stage: String(overrides.stage || ""),
    field_name: String(overrides.fieldName || ""),
    batch: 1,
    total_batches: normalized.length || 1,
    evidence_packet_count: packetCount || compressedResultsCount,
    source_types: Object.fromEntries(sourceTypes),
    chapters: {
      count: chapterList.length,
      min: chapterList[0] || null,
      max: chapterList[chapterList.length - 1] || null,
      sample: compactChapterSample(chapterList)
    },
    categories: Object.fromEntries(categories),
    fact_types: Object.fromEntries(factTypes),
    subjects: uniqueCompact(subjects, 12),
    related_subjects: uniqueCompact(relatedSubjects, 8),
    target_subject: targetSubject,
    target_evidence_count: targetEvidenceCount,
    field_material_mode: String(overrides.fieldMaterialMode || ""),
    prompt_overhead_chars: promptOverheadChars,
    material_chars: materialChars,
    compressed_results_count: compressedResultsCount,
    trimmed_by_budget: trimmedByBudget,
    omitted_by_budget: omittedByBudget,
    field_merge_mode: String(overrides.fieldMergeMode || ""),
    field_merge_batch_count: Number(overrides.fieldMergeBatchCount || normalized.length || 1),
    field_merge_model_used: Boolean(overrides.fieldMergeModelUsed),
    field_merge_fallback_reason: String(overrides.fieldMergeFallbackReason || ""),
    merged_value_chars: Number(overrides.mergedValueChars || 0)
  };
}

function mergeCountMap(target, source) {
  if (!source || typeof source !== "object") return;
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue;
    target.set(key, (target.get(key) || 0) + Number(value || 0));
  }
}

function countValues(values) {
  const counts = {};
  for (const value of values || []) {
    const key = String(value || "").trim();
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function uniqueCompact(values, limit) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))]
    .slice(0, limit);
}

function compactChapterSample(chapters, limit = 16) {
  const values = [...new Set(chapters || [])].filter(Boolean).sort((left, right) => left - right);
  if (values.length <= limit) return values;
  const headCount = Math.ceil(limit / 2);
  const tailCount = Math.floor(limit / 2);
  return [...values.slice(0, headCount), ...values.slice(-tailCount)];
}

function evidenceBaseMaterial({ sourceMaterial, fieldName, materialLabel, targetContext = null }) {
  const base = sourceMaterial && typeof sourceMaterial === "object" ? sourceMaterial : {};
  const targetSubject = targetContext?.subject || base.targetContext?.subject || "";
  return {
    sourceStats: base.sourceStats || {},
    failedChapters: Array.isArray(base.failedChapters) ? base.failedChapters.slice(0, 120) : [],
    missingChapters: Array.isArray(base.missingChapters) ? base.missingChapters.slice(0, 120) : [],
    target_subject: targetSubject,
    targetContext: targetContext || base.targetContext || null,
    split: {
      fieldName,
      materialLabel,
      mode: targetSubject && isLargeFieldName(fieldName) ? "target_dossier" : "evidence_packets",
      batch: 1,
      total: 1
    }
  };
}

function splitEvidencePacketsIntoBudgetedChunks({ baseMaterial, packets, userPrompt, fieldName, fieldSchema, materialLabel, targetContext = null, budget }) {
  if (!packets.length) {
    const emptyMaterial = { ...baseMaterial, evidence_packets: [] };
    return [ensureEvidenceInputWithinBudget({
      material: emptyMaterial,
      userPrompt,
      fieldName,
      fieldSchema,
      materialLabel,
      targetContext,
      budget
    })];
  }

  const chunks = [];
  let current = [];
  for (const packet of packets) {
    const candidate = [...current, packet];
    const candidateMaterial = budgetEvidenceMaterial({
      baseMaterial,
      packets: candidate,
      userPrompt,
      fieldName,
      fieldSchema,
      materialLabel,
      targetContext,
      budget,
      batch: chunks.length + 1,
      total: 1
    });
    if (current.length && candidateMaterial.evidence_packets.length < candidate.length) {
      chunks.push(current);
      current = [packet];
      continue;
    }
    if (current.length && inputTextLength(buildCustomFieldSummaryInput({
      userPrompt,
      sourceMaterial: candidateMaterial,
      materialLabel,
      fieldName,
      fieldSchema,
      targetContext
    })) > budget) {
      chunks.push(current);
      current = [packet];
      continue;
    }
    current = candidate;
  }
  if (current.length) chunks.push(current);

  const total = chunks.length || 1;
  return (chunks.length ? chunks : [[]]).map((chunk, index) => budgetEvidenceMaterial({
    baseMaterial,
    packets: chunk,
    userPrompt,
    fieldName,
    fieldSchema,
    materialLabel,
    targetContext,
    budget,
    batch: index + 1,
    total
  }));
}

function budgetEvidenceMaterial({ baseMaterial, packets, userPrompt, fieldName, fieldSchema, materialLabel, targetContext = null, budget, batch, total }) {
  const material = {
    ...baseMaterial,
    split: {
      ...(baseMaterial.split || {}),
      fieldName,
      materialLabel,
      batch,
      total
    },
    sourceStats: {
      ...(baseMaterial.sourceStats || {}),
      evidence_packet_count: packets.length
    },
    target_evidence_count: packets.filter((packet) => packet.target_match).length,
    evidence_packets: packets
  };
  return ensureEvidenceInputWithinBudget({
    material,
    userPrompt,
    fieldName,
    fieldSchema,
    materialLabel,
    targetContext,
    budget
  });
}

function ensureEvidenceInputWithinBudget({ material, userPrompt, fieldName, fieldSchema, materialLabel, targetContext = null, budget, preserveCoverage = false }) {
  let output = material;
  let packets = Array.isArray(output.evidence_packets) ? output.evidence_packets : [];
  if (preserveCoverage && inputTextLength(buildCustomFieldSummaryInput({
    userPrompt,
    sourceMaterial: output,
    materialLabel,
    fieldName,
    fieldSchema,
    targetContext
  })) > budget) {
    const passOnePackets = packets.map((packet) => compactEvidencePacketForBudget(packet, {
      contentChars: 48,
      evidenceItems: 0,
      evidenceChars: 0,
      tagItems: 0,
      tagChars: 0
    }));
    output = {
      ...output,
      sourceStats: {
        ...(output.sourceStats || {}),
        evidence_packet_count: passOnePackets.length,
        evidence_packets_trimmed_by_budget: true
      },
      evidence_packets: passOnePackets
    };
    packets = passOnePackets;
  }
  if (preserveCoverage && inputTextLength(buildCustomFieldSummaryInput({
    userPrompt,
    sourceMaterial: output,
    materialLabel,
    fieldName,
    fieldSchema,
    targetContext
  })) > budget) {
    const passTwoPackets = packets.map((packet) => compactEvidencePacketForBudget(packet, {
      contentChars: 16,
      evidenceItems: 0,
      evidenceChars: 0,
      tagItems: 0,
      tagChars: 0
    }));
    output = {
      ...output,
      sourceStats: {
        ...(output.sourceStats || {}),
        evidence_packet_count: passTwoPackets.length,
        evidence_packets_trimmed_by_budget: true
      },
      evidence_packets: passTwoPackets
    };
    packets = passTwoPackets;
  }
  while (packets.length && inputTextLength(buildCustomFieldSummaryInput({
    userPrompt,
    sourceMaterial: output,
    materialLabel,
    fieldName,
    fieldSchema,
    targetContext
  })) > budget) {
    packets = packets.slice(0, -1);
    output = {
      ...output,
      sourceStats: {
        ...(output.sourceStats || {}),
        evidence_packet_count: packets.length,
        evidence_packets_omitted_by_budget: Math.max(0, (material.evidence_packets || []).length - packets.length)
      },
      evidence_packets: packets
    };
  }
  if (inputTextLength(buildCustomFieldSummaryInput({
    userPrompt,
    sourceMaterial: output,
    materialLabel,
    fieldName,
    fieldSchema,
    targetContext
  })) <= budget) {
    return output;
  }

  const trimmedPackets = packets.map((packet) => ({
    ...packet,
    content: clipText(packet.content, 120),
    evidence: compactStringArray(packet.evidence, 1, 60)
  }));
  output = {
    ...output,
    sourceStats: {
      ...(output.sourceStats || {}),
      evidence_packet_count: trimmedPackets.length,
      evidence_packets_trimmed_by_budget: true
    },
    evidence_packets: trimmedPackets
  };
  while (trimmedPackets.length && inputTextLength(buildCustomFieldSummaryInput({
    userPrompt,
    sourceMaterial: output,
    materialLabel,
    fieldName,
    fieldSchema,
    targetContext
  })) > budget) {
    trimmedPackets.pop();
    output = {
      ...output,
      sourceStats: {
        ...(output.sourceStats || {}),
        evidence_packet_count: trimmedPackets.length,
        evidence_packets_omitted_by_budget: Math.max(0, (material.evidence_packets || []).length - trimmedPackets.length),
        evidence_packets_trimmed_by_budget: true
      },
      evidence_packets: [...trimmedPackets]
    };
  }
  return output;
}

function compactEvidencePacketForBudget(packet, { contentChars, evidenceItems, evidenceChars, tagItems, tagChars }) {
  const compacted = {
    source_type: packet.source_type,
    chapter_index: packet.chapter_index,
    category: packet.category,
    subject: packet.subject,
    related_subjects: compactStringArray(packet.related_subjects, 2, 20),
    fact_type: packet.fact_type,
    content: clipText(packet.content, contentChars),
    evidence: compactStringArray(packet.evidence, evidenceItems, evidenceChars),
    importance: packet.importance,
    confidence: packet.confidence,
    tags: compactStringArray(packet.tags, tagItems, tagChars)
  };
  for (const [key, value] of Object.entries(compacted)) {
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
      delete compacted[key];
    }
  }
  return compacted;
}

function buildEvidencePacketsForField({ sourceMaterial, fieldName, fieldSchema, userPrompt, targetContext = null }) {
  const material = sourceMaterial && typeof sourceMaterial === "object" ? sourceMaterial : {};
  const target = targetContext?.subject || material.targetContext?.subject || "";
  const packets = [];
  for (const fact of Array.isArray(material.facts) ? material.facts : []) {
    const packet = factToEvidencePacket(fact);
    if (packet) packets.push(packet);
  }
  for (const chapter of Array.isArray(material.reviewedChapters) ? material.reviewedChapters : []) {
    packets.push(...reviewedChapterToEvidencePackets(chapter));
  }
  for (const result of Array.isArray(material.compressedResults) ? material.compressedResults : []) {
    const packet = compressedResultToEvidencePacket(result);
    if (packet) packets.push(packet);
  }
  return dedupeEvidencePackets(packets)
    .map((packet) => {
      const targetMatch = Boolean(target && evidencePacketMatchesTarget(packet, target));
      const enrichedPacket = targetMatch && !packet.subject
        ? { ...packet, subject: target }
        : packet;
      return {
        ...enrichedPacket,
        target_match: targetMatch,
        relevance: evidenceRelevanceScore({ packet: enrichedPacket, fieldName, fieldSchema, userPrompt })
      };
    });
}

function materialHasEvidence(sourceMaterial) {
  const material = sourceMaterial && typeof sourceMaterial === "object" ? sourceMaterial : {};
  if (Array.isArray(material.evidence_packets) && material.evidence_packets.length) return true;
  if (Array.isArray(material.facts) && material.facts.length) return true;
  if (Array.isArray(material.reviewedChapters) && material.reviewedChapters.some((chapter) => Array.isArray(chapter?.facts) && chapter.facts.length)) return true;
  if (Array.isArray(material.compressedResults) && material.compressedResults.length) return true;
  return false;
}

function factToEvidencePacket(fact) {
  if (!fact || typeof fact !== "object") return null;
  return {
    source_type: fact.review_source === "source_review" ? "source_review" : "l2_fact",
    chapter_index: Number(fact.chapter_index || 0) || null,
    category: String(fact.category || ""),
    subject: String(fact.entity || ""),
    related_subjects: compactStringArray(fact.related_entities, 5, 40),
    fact_type: String(fact.fact_type || ""),
    content: clipText(fact.fact || "", EVIDENCE_PACKET_CONTENT_CHARS),
    evidence: compactStringArray(fact.evidence, 2, EVIDENCE_PACKET_EVIDENCE_CHARS),
    importance: numberOrNull(fact.importance),
    confidence: numberOrNull(fact.confidence),
    tags: compactStringArray(fact.tags, 6, 32)
  };
}

function reviewedChapterToEvidencePackets(chapter) {
  const chapterIndex = Number(chapter?.chapter_index || 0) || null;
  return (Array.isArray(chapter?.facts) ? chapter.facts : [])
    .map((fact) => factToEvidencePacket({ ...fact, chapter_index: chapterIndex, review_source: "source_review" }))
    .filter(Boolean)
    .map((packet) => ({
      ...packet,
      chapter_title: clipText(chapter?.title || "", 80)
    }));
}

function compressedResultToEvidencePacket(result) {
  if (!result || typeof result !== "object") return null;
  return {
    source_type: "chapter_summary",
    chapter_index: Number(result.chapter_index || 0) || null,
    chapter_title: clipText(result.chapter_title || result.title || "", 80),
    category: "",
    subject: "",
    related_subjects: [],
    fact_type: "chapter_summary",
    content: clipText(result.summary || summarizeUnknownResult(result, EVIDENCE_PACKET_CONTENT_CHARS), EVIDENCE_PACKET_CONTENT_CHARS),
    evidence: compactStringArray([
      ...(Array.isArray(result.key_points) ? result.key_points : []),
      ...(Array.isArray(result.evidence_notes) ? result.evidence_notes : [])
    ], 2, EVIDENCE_PACKET_EVIDENCE_CHARS),
    importance: null,
    confidence: null,
    tags: compactStringArray(result.key_points, 4, 32)
  };
}

function dedupeEvidencePackets(packets) {
  const seen = new Set();
  const output = [];
  for (const packet of packets) {
    const key = [
      packet.source_type,
      packet.chapter_index,
      packet.category,
      packet.subject,
      packet.fact_type,
      packet.content
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(packet);
  }
  return output;
}

function rankEvidencePackets({ packets, fieldName, fieldSchema, userPrompt }) {
  return [...packets].sort((left, right) => {
    const leftScore = evidenceRelevanceScore({ packet: left, fieldName, fieldSchema, userPrompt });
    const rightScore = evidenceRelevanceScore({ packet: right, fieldName, fieldSchema, userPrompt });
    return Number(Boolean(right.target_match)) - Number(Boolean(left.target_match))
      || rightScore - leftScore
      || Number(left.chapter_index || 0) - Number(right.chapter_index || 0);
  });
}

function evidenceRelevanceScore({ packet, fieldName, fieldSchema, userPrompt }) {
  const haystack = evidencePacketSearchText(packet);
  const fieldTokens = tokenizeForRelevance(fieldName);
  const promptTokens = tokenizeForRelevance(userPrompt).slice(0, 80);
  let score = Number(packet.importance || 0) * 3 + Number(packet.confidence || 0) * 1.5;
  if (packet.source_type === "source_review") score += 1.2;
  if (fieldSchema?.type === "array") score += 0.15;
  for (const token of fieldTokens) {
    if (token.length >= 2 && haystack.includes(token)) score += 1.6;
  }
  for (const token of promptTokens) {
    if (token.length >= 2 && haystack.includes(token)) score += 0.45;
  }
  return score;
}

function evidencePacketSearchText(packet) {
  return [
    packet.source_type,
    packet.category,
    packet.subject,
    packet.fact_type,
    packet.content,
    ...(packet.related_subjects || []),
    ...(packet.tags || []),
    ...(packet.evidence || [])
  ].map(normalizeRouteToken).join(" ");
}

function tokenizeForRelevance(value) {
  const text = normalizeRouteToken(value);
  const ascii = text.match(/[a-z0-9_]{2,}/g) || [];
  const cjk = text.match(/[\u4e00-\u9fa5]{2,}/g) || [];
  const fragments = [];
  for (const token of cjk) {
    fragments.push(token);
    for (let size = 2; size <= Math.min(4, token.length); size += 1) {
      for (let index = 0; index <= token.length - size; index += 1) {
        fragments.push(token.slice(index, index + size));
      }
    }
  }
  return [...new Set([...ascii, ...fragments])].filter((token) => !RELEVANCE_STOPWORDS.has(token));
}

const RELEVANCE_STOPWORDS = new Set([
  "json",
  "schema",
  "字段",
  "输出",
  "分析",
  "要求",
  "章节",
  "结果",
  "信息",
  "资料",
  "说明"
]);

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function evidencePacketMatchesTarget(packet, target) {
  const normalizedTarget = normalizeRouteToken(target);
  if (!normalizedTarget) return false;
  return evidencePacketSearchText(packet).includes(normalizedTarget);
}

function isLargeFieldName(fieldName) {
  return /sword|item|weapon|character|profile|setting|设定|飞剑|物品|角色|人物/i.test(String(fieldName || ""));
}

function summaryFieldCategories(field) {
  if (/character|角色|人物|appearance|外貌/.test(field)) return ["character", "relationship"];
  if (/relationship|关系/.test(field)) return ["relationship", "character"];
  if (/cultivation|修炼|境界|体系/.test(field)) return ["cultivation"];
  if (/item|weapon|物品|武器|法宝|剑/.test(field)) return ["item"];
  if (/force|faction|势力|宗门/.test(field)) return ["force"];
  if (/location|place|地点|空间/.test(field)) return ["location"];
  if (/event|事件|timeline|时间线/.test(field)) return ["event"];
  return [];
}

function maxFactsForSummaryField(field) {
  if (/core|核心/.test(field)) return 260;
  if (/important|重要/.test(field)) return 360;
  if (/minor|次要/.test(field)) return 220;
  if (/uncertain|uncertainties|conflict|风险|不确定/.test(field)) return 160;
  return 280;
}

function factMatchesAnyEntity(fact, entityQueries) {
  const text = factSearchText(fact);
  return entityQueries.some((entity) => text.includes(normalizeRouteToken(entity)));
}

function factSearchText(fact) {
  return [
    fact?.entity,
    fact?.fact_type,
    fact?.fact,
    ...(fact?.aliases || []),
    ...(fact?.tags || []),
    ...(fact?.related_entities || []),
    ...(fact?.evidence || [])
  ].map(normalizeRouteToken).join(" ");
}

function compactFactForFinalSummary(fact) {
  return {
    chapter_index: fact.chapter_index,
    category: fact.category,
    entity: fact.entity,
    related_entities: compactStringArray(fact.related_entities, 4, 40),
    fact_type: fact.fact_type,
    fact: clipText(fact.fact, 280),
    evidence: compactStringArray(fact.evidence, 2, 120),
    importance: fact.importance,
    confidence: fact.confidence
  };
}

function buildEvidenceSummaryInput({ userPrompt, sourceMaterial, materialLabel, contextLabel = "最终汇总" }) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            userPrompt,
            "",
            `以下是${materialLabel || "汇总素材"}的标准证据包 JSON。请基于这些证据包完成${contextLabel}。`,
            "要求：证据包已经包含来源类型、章节、主体、事实、证据摘记、重要度和置信度；不要要求重新读取原文。",
            "取舍：优先使用高相关、高重要度、高置信度证据；证据不足时保持不确定，不要补写不存在的信息。",
            "",
            "证据包素材 JSON：",
            JSON.stringify(sourceMaterial || {})
          ].join("\n")
        }
      ]
    }
  ];
}

function buildL2QuerySummaryInput({ query, sourceMaterial, sourceStats }) {
  const collectionMode = Boolean(sourceStats?.l2_query_collection_mode);
  const collectionInstructions = collectionMode ? [
    "- 这是集合型提取/排名任务：当前输入可能只是全库候选的一部分，请先提取本批次候选项，不要假装已经完成全库最终排名。",
    "- 每个候选项尽量保留名称、持有者/关联主体、重要性理由、章节线索和依据事实；信息不足的字段写“信息不足”。",
    "- 如果用户要求前 N/最重要，当前批次只给出本批次候选和局部重要性判断，最终排序由合并阶段完成。"
  ] : [];
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "你是小说 L2 事实库问答与设定小模块整理助手。",
            "",
            "用户查询：",
            query,
            "",
            "任务边界：",
            "- 只依据下方 L2 facts，不读取原文，不使用索引外资料。",
            "- 每个关键结论尽量标明章节。",
            "- 如果用户要求时间线，优先按章节顺序组织。",
            "- 如果某个称谓或描述只是近义表述、事实整理表述或推断，请和“直接事实表述”区分，不要写成原文逐字。",
            "- 证据不足时明确写出缺口，不要补写不存在的信息。",
            "- 默认输出 Markdown 正文，内容要适合阅读和消费，不要输出 JSON。",
            ...collectionInstructions,
            "",
            "召回统计 JSON：",
            JSON.stringify(sourceStats || {}),
            "",
            "L2 facts JSON：",
            JSON.stringify((sourceMaterial?.facts || []).map((fact) => ({
              chapter_index: fact.chapter_index,
              category: fact.category,
              entity: fact.entity,
              aliases: fact.aliases || [],
              tags: fact.tags || [],
              related_entities: fact.related_entities || [],
              fact_type: fact.fact_type,
              fact: fact.fact,
              evidence: fact.evidence || [],
              importance: fact.importance,
              confidence: fact.confidence,
              index_group_key: fact.index_group_key
            })))
          ].join("\n")
        }
      ]
    }
  ];
}

function splitL2QueryFactsIntoBudgetedChunks({ query, targetContext = null, sourceStats = {}, facts, budget }) {
  const rawFacts = Array.isArray(facts) ? facts : [];
  const chunks = [];
  let currentRawFacts = [];
  let currentFacts = [];
  let omittedByBudget = 0;
  for (const fact of rawFacts) {
    const compactFact = compactL2QueryFactForBudget(fact, {
      factChars: 420,
      evidenceItems: 1,
      evidenceChars: 80
    });
    const candidateFacts = [...currentFacts, compactFact];
    const candidateInput = buildL2QuerySummaryInput({
      query,
      sourceMaterial: {
        query,
        targetContext,
        sourceStats: {
          ...sourceStats,
          evidence_packet_count: candidateFacts.length
        },
        facts: candidateFacts
      },
      sourceStats
    });
    if (currentFacts.length && inputTextLength(candidateInput) > budget) {
      chunks.push({
        rawFacts: currentRawFacts,
        facts: currentFacts,
        omittedByBudget,
        trimmedByBudget: true
      });
      currentRawFacts = [];
      currentFacts = [];
    }

    const nextFact = currentFacts.length
      ? compactFact
      : fitSingleL2QueryFactWithinBudget({
        fact,
        query,
        targetContext,
        sourceStats,
        budget
      });
    if (!nextFact) {
      omittedByBudget += 1;
      continue;
    }
    currentRawFacts.push(fact);
    currentFacts.push(nextFact);
  }
  if (currentFacts.length) {
    chunks.push({
      rawFacts: currentRawFacts,
      facts: currentFacts,
      omittedByBudget,
      trimmedByBudget: true
    });
  }
  const total = chunks.length || 1;
  return chunks.map((chunk, index) => withL2QueryChunkInput({
    chunk: {
      ...chunk,
      batch: index + 1,
      total
    },
    query,
    targetContext,
    sourceStats,
    budget
  }));
}

function withL2QueryChunkInput({ chunk, query, targetContext = null, sourceStats = {}, budget }) {
  let facts = Array.isArray(chunk.facts) ? chunk.facts : [];
  let input = buildL2QuerySummaryInput({
    query,
    sourceMaterial: {
      query,
      targetContext,
      sourceStats: {
        ...sourceStats,
        evidence_packet_count: facts.length
      },
      facts
    },
    sourceStats
  });
  while (facts.length && inputTextLength(input) > budget) {
    facts = facts.slice(0, -1);
    input = buildL2QuerySummaryInput({
      query,
      sourceMaterial: {
        query,
        targetContext,
        sourceStats: {
          ...sourceStats,
          evidence_packet_count: facts.length
        },
        facts
      },
      sourceStats
    });
  }
  const rawFacts = (chunk.rawFacts || []).slice(0, facts.length);
  return {
    ...chunk,
    facts,
    rawFacts,
    input,
    omittedByBudget: Number(chunk.omittedByBudget || 0) + Math.max(0, (chunk.facts || []).length - facts.length),
    trimmedByBudget: true,
    chapters: [...new Set(rawFacts.map((fact) => Number(fact.chapter_index || 0)).filter(Boolean))]
      .sort((left, right) => left - right)
  };
}

function fitSingleL2QueryFactWithinBudget({ fact, query, targetContext = null, sourceStats = {}, budget }) {
  const attempts = [
    { factChars: 420, evidenceItems: 1, evidenceChars: 80 },
    { factChars: 220, evidenceItems: 1, evidenceChars: 48 },
    { factChars: 120, evidenceItems: 0, evidenceChars: 0 },
    { factChars: 60, evidenceItems: 0, evidenceChars: 0 }
  ];
  for (const attempt of attempts) {
    const compactFact = compactL2QueryFactForBudget(fact, attempt);
    const input = buildL2QuerySummaryInput({
      query,
      sourceMaterial: {
        query,
        targetContext,
        sourceStats: {
          ...sourceStats,
          evidence_packet_count: 1
        },
        facts: [compactFact]
      },
      sourceStats
    });
    if (inputTextLength(input) <= budget) return compactFact;
  }
  return null;
}

function compactL2QueryFactForBudget(fact, { factChars, evidenceItems, evidenceChars }) {
  return {
    chapter_index: fact?.chapter_index,
    category: fact?.category,
    entity: fact?.entity,
    aliases: compactStringArray(fact?.aliases, 4, 24),
    tags: compactStringArray(fact?.tags, 4, 24),
    related_entities: compactStringArray(fact?.related_entities, 4, 24),
    fact_type: fact?.fact_type,
    fact: clipText(fact?.fact || "", factChars),
    evidence: compactStringArray(fact?.evidence, evidenceItems, evidenceChars),
    importance: fact?.importance,
    confidence: fact?.confidence,
    index_group_key: fact?.index_group_key
  };
}

function buildL2QueryMergeInput({ query, sourceStats, batchResults, budget = SUMMARY_PART_INPUT_MAX_CHARS }) {
  const attempts = [3200, 1800, 1000, 560, 280, 140, 70, 40];
  let lastInput = null;
  for (const markdownChars of attempts) {
    const input = buildL2QueryMergeInputWithLimit({
      query,
      sourceStats,
      batchResults,
      markdownChars
    });
    lastInput = input;
    if (inputTextLength(input) <= budget) return input;
  }
  return lastInput;
}

function buildL2QueryMergeInputWithLimit({ query, sourceStats, batchResults, markdownChars }) {
  const collectionMode = Boolean(sourceStats?.l2_query_collection_mode);
  const collectionInstructions = collectionMode ? [
    "- 这是集合型提取/排名任务：请把各批候选按名称/别名去重，合并持有者、章节线索、重要性理由和证据缺口。",
    "- 如果用户要求“前 N”或“最重要”，请基于各批候选的重要性理由、章节跨度、事实密度和叙事关键性做最终排序。",
    "- 输出应优先是可读清单或表格；每项尽量包含名称、持有者/关联主体、重要程度、为什么重要、章节线索。"
  ] : [];
  const compactResults = (batchResults || []).map((result) => ({
    batch: result.batch,
    total: result.total,
    chapters: compactChapterSample(result.chapters || [], 10),
    fact_count: result.fact_count,
    markdown: clipText(result.markdown || "", markdownChars)
  }));
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "你是小说 L2 事实库问答与设定小模块整理助手。",
            "",
            "用户查询：",
            query,
            "",
            "任务：合并多个 L2 提问局部回答，输出最终 Markdown 正文。",
            "合并边界：",
            "- 只依据下方局部回答 Markdown，不读取原文，不使用索引外资料。",
            "- 保留章节线索；时间线类问题按章节顺序组织。",
            "- 去重同义表述；如果局部回答有冲突，优先保留章节更明确、表述更保守的结论。",
            "- 区分事实直接表述与整理推断，不要写成原文逐字。",
            "- 输出 Markdown 正文，不要输出 JSON。",
            ...collectionInstructions,
            "",
            "召回统计 JSON：",
            JSON.stringify(sourceStats || {}),
            "",
            "局部回答 Markdown JSON：",
            JSON.stringify(compactResults)
          ].join("\n")
        }
      ]
    }
  ];
}

function compactSummaryPromptForField(userPrompt, fieldName, target) {
  const text = stripLastJsonObjectTemplate(userPrompt);
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (target && line.includes(target)) return true;
      if (line.includes(fieldName)) return true;
      return /依据|原文|证据|不确定|不要|JSON|输出|消费|设定集|字段|目标|范围/.test(line);
    })
    .slice(0, 18);
  const summary = lines.join("\n");
  return clipText(summary || text, 2400);
}

function summarizeFieldSchemaForPrompt(schema, fieldName) {
  const shape = summarizeSchemaShape(schema, 0);
  return clipText(JSON.stringify({ field: fieldName, shape }), 3200);
}

function summarizeSchemaShape(schema, depth) {
  if (!schema || depth > 2) return schema?.type || "value";
  if (schema.anyOf) return { anyOf: schema.anyOf.map((entry) => summarizeSchemaShape(entry, depth + 1)).slice(0, 4) };
  if (schema.type === "array") return { type: "array", items: summarizeSchemaShape(schema.items, depth + 1) };
  if (schema.type === "object") {
    const properties = schema.properties || {};
    return {
      type: "object",
      fields: Object.fromEntries(Object.entries(properties)
        .slice(0, 24)
        .map(([key, value]) => [key, summarizeSchemaShape(value, depth + 1)]))
    };
  }
  return schema.type || "value";
}

function promptOverheadLength({ userPrompt, fieldName, fieldSchema, materialLabel, targetContext }) {
  const input = buildCustomFieldSummaryInput({
    userPrompt,
    sourceMaterial: {},
    materialLabel,
    fieldName,
    fieldSchema,
    targetContext
  });
  return inputTextLength(input);
}

function buildCustomFieldSummaryInput({ userPrompt, sourceMaterial, materialLabel, fieldName, fieldSchema, targetContext = null }) {
  const target = targetContext?.subject || sourceMaterial?.target_subject || sourceMaterial?.targetContext?.subject || "";
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "用户任务约束摘要：",
            compactSummaryPromptForField(userPrompt, fieldName, target),
            `以下是${materialLabel || "汇总素材"}的标准证据包 JSON。请基于这些证据包进行最终汇总。`,
            "注意：证据包已经包含来源类型、章节、主体、事实、证据摘记、重要度和置信度；不要要求重新读取原文。",
            "取舍：优先使用高相关、高重要度、高置信度证据；证据不足时保持不确定，不要补写不存在的信息。",
            target ? `目标主体：${target}` : "目标主体：未识别",
            "",
            `当前只生成最终 JSON 的一个顶层字段：${fieldName}`,
            "输出要求：",
            `- 只输出一个 JSON 对象，且只包含 ${fieldName} 这一个顶层字段。`,
            "- 字段含义、颗粒度、命名和取舍标准必须服从用户汇总 Prompt 中同名字段。",
            "- 如果该字段确实没有可用信息，输出符合字段类型的空值；不要输出 N/A、暂无、占位说明。",
            "- 不要输出 Markdown，不要输出其他顶层字段。",
            "",
            "当前字段 Schema 摘要：",
            summarizeFieldSchemaForPrompt(fieldSchema || looseJsonValueSchema(), fieldName),
            "",
            "证据包素材 JSON：",
            JSON.stringify(sourceMaterial || {})
          ].join("\n")
        }
      ]
    }
  ];
}

function buildCustomFieldMergeInput({ userPrompt, fieldName, fieldSchema, targetContext = null, batchValues, mergedValue }) {
  const target = targetContext?.subject || "";
  const attempts = [
    { stringLimit: 900, arrayLimit: 12 },
    { stringLimit: 500, arrayLimit: 10 },
    { stringLimit: 260, arrayLimit: 8 },
    { stringLimit: 140, arrayLimit: 6 }
  ];
  let lastInput = null;
  for (const attempt of attempts) {
    const input = buildCustomFieldMergeInputWithLimits({
      userPrompt,
      fieldName,
      fieldSchema,
      target,
      batchValues,
      mergedValue,
      ...attempt
    });
    lastInput = input;
    if (inputTextLength(input) <= SUMMARY_PART_INPUT_MAX_CHARS) return input;
  }
  return lastInput;
}

function buildCustomFieldMergeInputWithLimits({
  userPrompt,
  fieldName,
  fieldSchema,
  target,
  batchValues,
  mergedValue,
  stringLimit,
  arrayLimit
}) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: [
            "用户任务约束摘要：",
            compactSummaryPromptForField(userPrompt, fieldName, target),
            "",
            `当前任务：合并最终 JSON 顶层字段 ${fieldName} 的多个分块结果。`,
            target ? `目标主体：${target}` : "目标主体：未识别",
            "合并要求：",
            "- 只能使用分块结果和递归合并候选中的信息，不要新增事实。",
            "- 保留不同分块中的互补字段和证据引用。",
            "- 不要用“信息不足”“不详”“未知”覆盖已有有效事实。",
            "- 如果模型综合会变薄，以递归合并候选为准。",
            "- 只输出一个 JSON 对象，且只包含当前字段。",
            "",
            "当前字段 Schema 摘要：",
            summarizeFieldSchemaForPrompt(fieldSchema || looseJsonValueSchema(), fieldName),
            "",
            "递归合并候选 JSON：",
            JSON.stringify({ [fieldName]: compactValueForMergePrompt(mergedValue, { stringLimit, arrayLimit }) }),
            "",
            "分块结果 JSON：",
            JSON.stringify((batchValues || []).map((value, index) => ({
              batch: index + 1,
              value: compactValueForMergePrompt(value, { stringLimit, arrayLimit })
            })))
          ].join("\n")
        }
      ]
    }
  ];
}

function compactValueForMergePrompt(value, { stringLimit, arrayLimit }) {
  if (typeof value === "string") return clipText(value, stringLimit);
  if (Array.isArray(value)) {
    return value.slice(0, arrayLimit).map((item) => compactValueForMergePrompt(item, { stringLimit, arrayLimit }));
  }
  if (isPlainObject(value)) {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = compactValueForMergePrompt(entry, { stringLimit, arrayLimit });
    }
    return output;
  }
  return value;
}

function safeSchemaName(value) {
  const normalized = String(value || "")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return normalized || "custom_field";
}

async function runSummaryStageWithRetry(task, stageLabel, operation) {
  let lastError;
  for (let attempt = 1; attempt <= SUMMARY_STAGE_MAX_ATTEMPTS; attempt += 1) {
    await waitIfPaused(task);
    try {
      const result = await operation();
      assertNotCancelled(task);
      return result;
    } catch (error) {
      lastError = error;
      if (!shouldRetrySummaryStage(error) || attempt >= SUMMARY_STAGE_MAX_ATTEMPTS) {
        throw error;
      }
      updateTask(task, {
        progress: { ...task.progress, current: stageLabel },
        message: `${stageLabel} 失败，准备重试 ${attempt + 1}/${SUMMARY_STAGE_MAX_ATTEMPTS}：${sanitizeText(error.message)}`
      }, "warning");
      await delay(SUMMARY_STAGE_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

function shouldRetrySummaryStage(error) {
  const message = String(error?.message || "").toLowerCase();
  if (error?.status === 429 || error?.status >= 500) return true;
  return [
    "aborted",
    "timeout",
    "timed out",
    "fetch failed",
    "network",
    "网络连接失败",
    "unexpected end of json input",
    "不是合法 json"
  ].some((pattern) => message.includes(pattern));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseOutputSchemaOrNull(value) {
  try {
    const schema = JSON.parse(String(value || ""));
    return schema && typeof schema === "object" ? schema : null;
  } catch {
    return null;
  }
}

function deriveFinalSummarySchema({ userPrompt, configuredSchema }) {
  const promptSchema = schemaFromPromptJsonTemplate(userPrompt);
  if (promptSchema) {
    return {
      schema: promptSchema,
      schemaName: "custom_final_analysis",
      strict: false
    };
  }

  const arrayItemFieldSchema = schemaFromPromptJsonArrayFieldDeclaration(userPrompt);
  if (arrayItemFieldSchema) {
    return {
      schema: arrayItemFieldSchema,
      schemaName: "custom_final_analysis",
      strict: false,
      unwrapField: "items"
    };
  }

  const declaredFieldSchema = schemaFromPromptFieldDeclaration(userPrompt);
  if (declaredFieldSchema) {
    return {
      schema: declaredFieldSchema,
      schemaName: "custom_final_analysis",
      strict: false
    };
  }

  if (configuredSchema && shouldUseJsonFinalSummary(userPrompt)) {
    return {
      schema: configuredSchema,
      schemaName: "final_analysis",
      strict: true
    };
  }

  return null;
}

function shouldUseJsonFinalSummary(userPrompt) {
  const prompt = String(userPrompt || "");
  const lower = prompt.toLowerCase();
  if (
    /不要\s*(输出)?\s*json/i.test(prompt)
    || /不(?:要|用|需要)\s*(输出)?\s*json/i.test(prompt)
    || /禁止\s*(输出)?\s*json/i.test(prompt)
    || /纯文本/.test(prompt)
    || /(?<!不)(?<!不要)(?<!禁止)(?:输出|使用|采用|按照|按|以)[^。；\n]*markdown/i.test(prompt)
    || /(?<!不)(?<!不要)(?<!禁止)markdown[^。；\n]*(?:格式|输出|呈现)/i.test(prompt)
    || /(?<!不)(?<!不要)(?<!禁止)表格/.test(prompt)
    || /按(?:照)?[^。；\n]*(格式|模板)[^。；\n]*(输出|呈现)/.test(prompt)
    || lower.includes("plain text")
  ) {
    return false;
  }
  return /json\s*schema/i.test(prompt)
    || /schema\s*json/i.test(prompt)
    || /给定\s*(?:的)?\s*(?:json\s*)?schema/i.test(prompt)
    || /匹配[^。；\n]*(?:json\s*)?schema/i.test(prompt)
    || /符合[^。；\n]*(?:json\s*)?schema/i.test(prompt)
    || /按[^。；\n]*(?:json\s*)?schema/i.test(prompt)
    || /最终输出必须匹配给定\s*json\s*schema/i.test(prompt);
}

function schemaFromPromptJsonTemplate(userPrompt) {
  const template = extractLastJsonObjectTemplate(userPrompt);
  if (!template || Array.isArray(template)) return null;
  return schemaFromJsonTemplate(template);
}

function schemaFromPromptFieldDeclaration(userPrompt) {
  const text = String(userPrompt || "");
  if (!/json/i.test(text)) return null;
  const declaration = findTopLevelFieldDeclaration(text);
  if (!declaration) return null;
  const uniqueFields = declaredFieldsFromSegment(declaration[1]);
  if (uniqueFields.length < 2) return null;
  return schemaFromDeclaredFields(uniqueFields);
}

function schemaFromPromptJsonArrayFieldDeclaration(userPrompt) {
  const text = String(userPrompt || "");
  if (!/json/i.test(text)) return null;
  const declaration = findArrayItemFieldDeclaration(text);
  if (!declaration) return null;
  const fields = declaredFieldsFromSegment(declaration[1]);
  if (fields.length < 2) return null;
  return schemaFromDeclaredItemFields(fields);
}

function findTopLevelFieldDeclaration(text) {
  const pattern = /(?:字段包括|字段为|顶层字段(?:包括|为)?|JSON\s*字段(?:包括|为)?)[：:\s]*([\s\S]{0,600})/ig;
  for (const match of text.matchAll(pattern)) {
    const prefix = text.slice(Math.max(0, match.index - 24), match.index);
    if (/(?:每个|每一|每项|每条|每条记录|对象|条目|数组|元素|记录)\s*$/.test(prefix)) continue;
    return match;
  }
  return null;
}

function findArrayItemFieldDeclaration(text) {
  const patterns = [
    /(?:JSON\s*)?数组[^。；\n]{0,140}?(?:每(?:个|一)?(?:对象|条目|项|元素|记录)|数组(?:对象|条目|项|元素|记录)?)[^。；\n]{0,50}?(?:字段(?:包括|为)?|包含字段)[：:\s]*([\s\S]{0,600})/i,
    /(?:每(?:个|一)?(?:对象|条目|项|元素|记录)|数组(?:对象|条目|项|元素|记录)?)[^。；\n]{0,80}?(?:字段(?:包括|为)?|包含字段)[：:\s]*([\s\S]{0,600})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const contextStart = Math.max(0, (match.index || 0) - 160);
    const context = text.slice(contextStart, (match.index || 0) + match[0].length);
    if (/json\s*数组|数组/i.test(context)) return match;
  }
  return null;
}

function declaredFieldsFromSegment(value) {
  const segment = String(value || "").split(/\n\s*\n|。|；|;/)[0] || "";
  const fields = segment
    .split(/[、,，\s]+/)
    .map(cleanDeclaredFieldToken)
    .filter(isValidDeclaredFieldName);
  return [...new Set(fields)];
}

function cleanDeclaredFieldToken(value) {
  return String(value || "")
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, "")
    .replace(/[：:。；;,.，、]+$/g, "")
    .trim();
}

function isValidDeclaredFieldName(value) {
  return /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]{0,80}$/.test(String(value || ""));
}

function schemaFromDeclaredFields(fields) {
  const properties = {};
  for (const field of fields) {
    properties[field] = schemaForDeclaredField(field);
  }
  return {
    type: "object",
    additionalProperties: true,
    properties,
    required: fields
  };
}

function schemaFromDeclaredItemFields(fields) {
  const properties = {};
  for (const field of fields) {
    properties[field] = schemaForDeclaredField(field);
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties,
          required: fields
        }
      }
    },
    required: ["items"]
  };
}

function schemaForDeclaredField(fieldName) {
  const normalized = String(fieldName || "").toLowerCase();
  if (/characters|uncertainties|items|stages|evidence|chapters|facts|list|array/.test(normalized)) {
    return {
      type: "array",
      items: { type: "object", additionalProperties: true }
    };
  }
  if (/count|chapter_index|start_chapter|end_chapter/.test(normalized)) return { type: "integer" };
  if (/is_|has_|should_|重大|是否/.test(normalized)) return { type: "boolean" };
  return { type: "string" };
}

function extractLastJsonObjectTemplate(value) {
  const text = String(value || "");
  const range = lastJsonObjectTemplateRange(text);
  if (!range) return null;
  try {
    return JSON.parse(text.slice(range.start, range.end + 1));
  } catch {
    return null;
  }
}

function lastJsonObjectTemplateRange(value) {
  const text = String(value || "");
  for (let end = text.length - 1; end >= 0; end -= 1) {
    if (text[end] !== "}") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let start = end; start >= 0; start -= 1) {
      const char = text[start];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }
      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === "}") depth += 1;
      if (char === "{") {
        depth -= 1;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(text.slice(start, end + 1));
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { start, end };
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function schemaFromJsonTemplate(value) {
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length ? schemaFromJsonTemplate(value[0]) : looseJsonValueSchema()
    };
  }
  if (value && typeof value === "object") {
    const properties = {};
    const required = [];
    for (const [key, entry] of Object.entries(value)) {
      properties[key] = schemaFromJsonTemplate(entry);
      required.push(key);
    }
    return {
      type: "object",
      additionalProperties: true,
      properties,
      required
    };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (value === null) return looseJsonValueSchema();
  return { type: "string" };
}

function looseJsonValueSchema() {
  return {
    anyOf: [
      { type: "string" },
      { type: "number" },
      { type: "integer" },
      { type: "boolean" },
      { type: "object", additionalProperties: true },
      { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }, { type: "integer" }, { type: "boolean" }, { type: "object", additionalProperties: true } ] } }
    ]
  };
}

function inputTextLength(input) {
  return input.reduce((sum, item) => (
    sum + (item.content || []).reduce((inner, content) => inner + String(content.text || "").length, 0)
  ), 0);
}

function compactChapterResultsForSummary({ chapterResults, failedChapters, userPrompt, targetChars = SUMMARY_COMPACT_TARGET_CHARS }) {
  const count = Math.max(1, chapterResults.length);
  const promptReserve = String(userPrompt || "").length + JSON.stringify(failedChapters || []).length + 1500;
  const perChapterBudget = Math.max(80, Math.min(420, Math.floor((targetChars - promptReserve) / count)));
  return chapterResults.map((result) => compactChapterResult(result, perChapterBudget));
}

function compactChapterResult(result, budget) {
  const chapterIndex = Number(result?.chapter_index || 0);
  const title = clipText(result?.chapter_title || result?.title || "", 80);
  const summaryBudget = Math.max(80, Math.floor(budget * 0.48));
  const keyPointBudget = Math.max(55, Math.floor(budget * 0.22));
  const evidenceBudget = Math.max(40, Math.floor(budget * 0.12));
  const fallback = summarizeUnknownResult(result, Math.max(100, Math.floor(budget * 0.7)));
  return {
    chapter_index: chapterIndex,
    chapter_title: title,
    summary: clipText(result?.summary || fallback, summaryBudget),
    key_points: compactStringArray(result?.key_points, 2, keyPointBudget),
    evidence_notes: compactStringArray(result?.evidence_notes, 1, evidenceBudget)
  };
}

function compactStringArray(value, maxItems, maxChars) {
  const items = Array.isArray(value) ? value : [];
  return items
    .map((item) => clipText(item, maxChars))
    .filter(Boolean)
    .slice(0, maxItems);
}

function summarizeUnknownResult(value, maxChars) {
  if (!value || typeof value !== "object") return clipText(value, maxChars);
  const fragments = [];
  for (const [key, entry] of Object.entries(value)) {
    if (["chapter_index", "chapter_title", "title"].includes(key)) continue;
    if (typeof entry === "string") {
      fragments.push(`${key}: ${entry}`);
    } else if (Array.isArray(entry)) {
      fragments.push(`${key}: ${entry.slice(0, 3).map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("; ")}`);
    }
    if (fragments.join(" ").length >= maxChars) break;
  }
  return clipText(fragments.join(" "), maxChars);
}

function clipText(value, maxChars) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function parseJsonOrText(value) {
  if (value && typeof value === "object") return value;
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function parseJsonObject(value) {
  if (!value) return null;
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function assertFinalSummaryUseful(finalResult, sourceChapterCount, options = {}) {
  if (sourceChapterCount < 3) return;

  if (typeof finalResult === "string") {
    const text = finalResult.trim();
    if (text && !isPlaceholderText(text)) return;
    throw finalSummaryQualityError();
  }

  if (!finalResult || typeof finalResult !== "object") {
    throw finalSummaryQualityError();
  }

  const summary = String(finalResult.summary || "").trim();
  const title = String(finalResult.title || "").trim();
  const items = Array.isArray(finalResult.items) ? finalResult.items : [];
  const hasUsefulSummary = Boolean(summary) && !isPlaceholderText(summary);
  const hasUsefulTitle = Boolean(title) && !isPlaceholderText(title);
  if (items.length || hasUsefulSummary || hasUsefulTitle || hasAnyUsefulCustomValue(finalResult, options)) return;
  throw finalSummaryQualityError();
}

function hasAnyUsefulCustomValue(value, options = {}) {
  let hasContentField = false;
  let hasUsefulContentField = false;
  const properties = options.schema?.properties && typeof options.schema.properties === "object"
    ? options.schema.properties
    : {};
  for (const [key, entry] of Object.entries(value)) {
    if (["title", "summary", "items", "failed_chapters"].includes(key)) continue;
    const schema = properties[key];
    const isContentField = isFinalContentField(key, schema, entry);
    if (isContentField) {
      hasContentField = true;
      if (isUsefulFinalValue(entry)) hasUsefulContentField = true;
      continue;
    }
    if (isUsefulFinalValue(entry)) return true;
  }
  return hasContentField ? hasUsefulContentField : false;
}

function isFinalContentField(fieldName, fieldSchema, value) {
  if (isMetadataOnlyFieldName(fieldName)) return false;
  if (isAnalysisParameterField(fieldName, fieldSchema)) return false;
  if (isOptionalSummaryFieldName(fieldName)) {
    return false;
  }
  return isPotentialPrimaryContentField(fieldName, fieldSchema, value);
}

function isRequiredPrimaryContentField(fieldName) {
  return /timeline|records|entries|results|characters|subjects|entities|时间线|记录|结果|人物|角色|主体|实体/i.test(String(fieldName || ""));
}

function isPotentialPrimaryContentField(fieldName, fieldSchema, value) {
  return isPrimaryContentFieldName(fieldName) && (isLargeFieldSchema(fieldSchema) || Array.isArray(value) || (value && typeof value === "object"));
}

function isPrimaryContentFieldName(fieldName) {
  return /timeline|records|entries|items|results|facts|events|characters|subjects|entities|stages|chapters|assets|list|array|时间线|记录|结果|事实|事件|人物|角色|主体|实体|阶段|章节|资产|列表/i.test(String(fieldName || ""));
}

function isOptionalSummaryFieldName(fieldName) {
  return /uncertain|uncertainties|conflict|risk|warning|error|failed|missing|important|minor|secondary|optional|note|notes|不确定|冲突|风险|失败|缺失|重要|次要|可选|备注/i.test(String(fieldName || ""));
}

function isUsefulFinalValue(value) {
  if (typeof value === "string") return Boolean(value.trim()) && !isPlaceholderText(value);
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => isUsefulFinalValue(item));
  if (value && typeof value === "object") return Object.values(value).some((entry) => isUsefulFinalValue(entry));
  return false;
}

function isPlaceholderText(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["", "n/a", "na", "null", "none", "无", "暂无", "空"].includes(normalized);
}

function finalSummaryQualityError() {
  const error = new Error("最终汇总结果疑似占位或为空，已拒绝保存。请续跑最终汇总。");
  error.status = 502;
  return error;
}

function emptyContentFieldError(fieldName) {
  const error = new Error(`最终汇总字段 ${fieldName} 有可用证据但结果为空，已拒绝保存。请续跑最终汇总。`);
  error.status = 502;
  return error;
}

function buildL1AnalysisContext({ bookId, chapters, startChapter, endChapter }) {
  const chapterIndexes = listL1ChapterIndexes(bookId, startChapter, endChapter)
    .filter((chapter) => chapter.status === "completed");
  const chaptersByIndex = new Map(chapterIndexes.map((chapter) => [chapter.chapter_index, chapter]));
  const missingChapters = chapters
    .filter((chapter) => !chaptersByIndex.has(chapter.chapter_index))
    .map((chapter) => chapter.chapter_index);
  return {
    chaptersByIndex,
    missingChapters
  };
}

function withL1ChapterContext(userPrompt, chapterIndex) {
  if (!chapterIndex) return userPrompt;
  return [
    userPrompt,
    "",
    "可选 L1 章节上下文 JSON：",
    JSON.stringify({
      summary: chapterIndex.summary,
      keywords: chapterIndex.keywords,
      entities: chapterIndex.entities,
      key_events: chapterIndex.key_events,
      items_places_orgs: chapterIndex.items_places_orgs,
      open_questions: chapterIndex.open_questions
    })
  ].join("\n");
}

export async function publicAnalysisRunWithResult(id) {
  const run = getAnalysisRun(id);
  if (!run) {
    const error = new Error("分析任务不存在。");
    error.status = 404;
    throw error;
  }
  const chapters = listAnalysisChapterMetadata(id);
  const summaryParts = listAnalysisSummaryPartMetadata(id);
  const promptConfigError = isAnalysisPromptConfigError(run.error_summary);
  const visibleSummaryParts = promptConfigError ? [] : summaryParts;
  const sourceTrace = sourceTraceFromSummaryParts(summaryParts);
  const chapterResults = await decryptCompletedAnalysisChapterResults(id);
  const resultIndexes = new Set(chapterResults.map((entry) => entry.chapter_index));
  const selection = parseChapterSelection(run);
  const byChapter = new Map(chapters.map((chapter) => [chapter.chapter_index, chapter]));
  const failedChapterIndexes = chapters
    .filter((chapter) => chapter.status === "failed")
    .map((chapter) => chapter.chapter_index);
  const pendingChapterIndexes = selection.chapter_indexes.filter((chapterIndex) => {
    const entry = byChapter.get(chapterIndex);
    return !entry || entry.status !== "completed" || !entry.has_result;
  });
  return {
    ...publicAnalysisRun(run),
    chapters,
    chapterResults,
    failedChapterIndexes,
    pendingChapterIndexes,
    completedChapterIndexes: [...resultIndexes].sort((left, right) => left - right),
    canResume: canResumeAnalysisRun(run, chapters, selection),
    summaryParts: visibleSummaryParts,
    summaryProgress: summaryProgressFromParts(visibleSummaryParts),
    failedSummaryParts: visibleSummaryParts.filter((part) => part.status === "failed"),
    canResumeSummary: visibleSummaryParts.some((part) => part.status === "failed"),
    sourceTrace,
    sourceTraceSummary: sourceTraceSummary(sourceTrace),
    prompt: await decryptAnalysisPromptSnapshot(id),
    finalResult: run.status === "completed" && run.ciphertext ? await decryptFinalAnalysisResult(id) : null
  };
}

function isAnalysisPromptConfigError(message) {
  return /分析 Prompt 的字段 .*?(缺少具体分析对象|目标范围|仍是占位内容)/.test(String(message || ""));
}

export function publicAnalysisRun(run) {
  if (!run) return null;
  const selection = parseChapterSelection(run);
  return {
    id: run.id,
    name: run.name || `${run.book_id} ${run.start_chapter}-${run.end_chapter}`,
    book_id: run.book_id,
    start_chapter: run.start_chapter,
    end_chapter: run.end_chapter,
    chapter_indexes: selection.chapter_indexes,
    selection_mode: selection.mode,
    model: run.model,
    reasoning_effort: run.reasoning_effort,
    prompt_hash: run.prompt_hash,
    schema_hash: run.schema_hash,
    status: run.status,
    chapter_count: run.chapter_count,
    error_summary: run.error_summary,
    source_stats: parseJsonObject(run.source_stats),
    created_at: run.created_at,
    updated_at: run.updated_at
  };
}

export function getL2IndexCoverageForBook({ bookId, indexGroupKey = "base", startChapter, endChapter }) {
  const settings = getPromptSettings();
  const indexGroup = getBookIndexGroup(bookId, indexGroupKey);
  if (!indexGroup || !indexGroup.enabled) {
    const error = new Error(`索引组不存在或已禁用：${indexGroupKey || "base"}`);
    error.status = 404;
    throw error;
  }
  return getL2Coverage({
    bookId,
    indexGroupKey: indexGroup.group_key,
    startChapter,
    endChapter,
    model: l2IndexExecutionSignature(settings.model),
    promptHash: indexGroupL2PromptHash(indexGroup),
    schemaVersion: L2_SCHEMA_VERSION
  });
}

export function getL1IndexCoverageForBook({ bookId, startChapter, endChapter, includeWindows = false }) {
  const settings = getPromptSettings();
  const bookPrompts = getBookIndexPrompts(bookId);
  return getL1Coverage({
    bookId,
    startChapter,
    endChapter,
    model: l1IndexExecutionSignature(settings.model),
    promptHash: bookL1IndexPromptHash(bookPrompts),
    includeWindows
  });
}

export async function listL2FactsForBook({ bookId, indexGroupKey, indexGroupKeys, startChapter, endChapter, category, entity, limit }) {
  const keys = indexGroupKeys || indexGroupKey || "base";
  return listL2Facts({
    bookId,
    indexGroupKeys: keys,
    startChapter,
    endChapter,
    categories: category ? String(category).split(",") : [],
    entity,
    limit,
    includeContent: true
  });
}

function rangeIndexes(start, end) {
  const indexes = [];
  for (let index = start; index <= end; index += 1) indexes.push(index);
  return indexes;
}

function isFatalUpstreamError(message) {
  return /成本保护|rate limit|quota|insufficient_quota|billing|429/i.test(String(message || ""));
}

function normalizeChapterIndexes(value) {
  if (!Array.isArray(value)) return [];
  const indexes = value.map((entry) => normalizeChapterIndex(entry));
  return [...new Set(indexes)].sort((left, right) => left - right);
}

function normalizeAnalysisMode(value) {
  return ["l2_query", "fast_index", "balanced", "precision", "full_text"].includes(value) ? value : "balanced";
}

function normalizeL2BuildMode(value) {
  return ["all", "missing", "retry_failed"].includes(value) ? value : "all";
}

function normalizeOptionalBudget(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.min(100, number);
}

function sourceReviewBudgetForMode(mode, chapterCount, override) {
  if (Number.isInteger(override)) return override;
  if (mode === "fast_index") return 0;
  if (mode === "precision") return Math.min(30, Math.max(5, Math.ceil(chapterCount * 0.03)));
  if (mode === "balanced") return Math.min(10, Math.max(3, Math.ceil(chapterCount * 0.01)));
  return 0;
}

function inferL2CategoriesFromPrompt(prompt) {
  const text = String(prompt || "").toLowerCase();
  const categories = new Set();
  if (/人物|角色|主角|配角|身份|character|role/.test(text)) categories.add("character");
  if (/关系|羁绊|师徒|敌友|relationship/.test(text)) categories.add("relationship");
  if (/境界|修炼|功法|体系|cultivation/.test(text)) categories.add("cultivation");
  if (/宗门|势力|门派|组织|force|faction|sect/.test(text)) categories.add("force");
  if (/武器|法宝|物品|道具|item|weapon/.test(text)) categories.add("item");
  if (/地点|地图|空间|location|place/.test(text)) categories.add("location");
  if (/事件|剧情|时间线|event|timeline/.test(text)) categories.add("event");
  if (/伏笔|线索|foreshadow/.test(text)) categories.add("foreshadowing");
  return categories.size ? [...categories] : [];
}

function inferEntityQueriesFromPrompt(prompt, bookId = "") {
  const text = String(prompt || "");
  const stopwords = new Set([
    "json",
    "schema",
    "markdown",
    "剑来",
    "第一瞳术师",
    "废材那又怎样",
    String(bookId || "")
  ].filter(Boolean));
  const candidates = [
    ...[...text.matchAll(/[《“「『]([^》”」』]{1,24})[》”」』]/g)].map((match) => match[1]),
    ...[...text.matchAll(/(?:主体|对象|关键词|关键主体|分析对象|围绕|关于|聚焦|只看|查询)[:：为是\s]*([^\n，。；;、]{2,40})/g)].flatMap((match) => splitEntityCandidates(match[1])),
    ...[...text.matchAll(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:本命飞剑|飞剑|本命物|佩剑|剑|法宝|境界|关系|外貌|形象|身份)/g)].map((match) => match[0]),
    ...[...text.matchAll(/(?:陈平安|齐静春|宁姚|阮邛|阿良|崔瀺|陆沉|老秀才|左右|裴钱|魏檗|宋集薪|顾璨|刘羡阳|云筝|容烁|飞剑|本命飞剑|本命物)/g)].map((match) => match[0])
  ];
  const normalized = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const value = normalizeEntityCandidate(candidate);
    if (!value || stopwords.has(value) || /json|schema|markdown/i.test(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized.slice(0, 6);
}

function splitEntityCandidates(value) {
  return String(value || "")
    .split(/[、,，/和与及\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeEntityCandidate(value) {
  return String(value || "")
    .replace(/[。；;：:，,、]/g, " ")
    .trim()
    .replace(/^(请|要|需要|分析|总结|整理|输出|围绕|关于|聚焦|只看|中|里|其中|有关|关于)+/, "")
    .replace(/(相关|有关|的信息|的内容|资料|设定|分析|总结|输出)+$/, "")
    .trim()
    .slice(0, 24);
}

function resolveSelectedChapters({ bookId, startChapter, endChapter, chapterIndexes }) {
  const metadata = listChapterMetadata(bookId);
  const byIndex = new Map(metadata.map((chapter) => [chapter.chapter_index, chapter]));
  const selectedIndexes = chapterIndexes.length
    ? chapterIndexes
    : metadata
      .filter((chapter) => chapter.chapter_index >= startChapter && chapter.chapter_index <= endChapter)
      .map((chapter) => chapter.chapter_index);

  const outsideRange = selectedIndexes.filter((index) => index < startChapter || index > endChapter);
  if (outsideRange.length) {
    const error = new Error(`选择章节超出范围：${outsideRange.join(", ")}`);
    error.status = 422;
    throw error;
  }

  const missing = selectedIndexes.filter((index) => !byIndex.has(index));
  if (missing.length) {
    const error = new Error(`本地章节库缺少已选择章节：${missing.join(", ")}`);
    error.status = 422;
    throw error;
  }

  return selectedIndexes.map((index) => byIndex.get(index));
}

function parseChapterSelection(run) {
  try {
    const parsed = run.chapter_selection ? JSON.parse(run.chapter_selection) : null;
    if (parsed?.chapter_indexes?.length) {
      return {
        mode: parsed.mode || "indexes",
        chapter_indexes: parsed.chapter_indexes
      };
    }
  } catch {
    // Old runs have no selection snapshot.
  }
  return {
    mode: "range",
    chapter_indexes: rangeIndexes(run.start_chapter, run.end_chapter)
  };
}

function canResumeAnalysisRun(run, chapters, selection) {
  if (!run || run.ciphertext || !run.prompt_ciphertext) return false;
  if (run.status === "completed") return false;
  const selectedCount = selection.chapter_indexes.length || run.chapter_count || 0;
  if (!selectedCount) return false;
  const completed = chapters.filter((chapter) => chapter.status === "completed" && chapter.has_result).length;
  return completed < selectedCount || run.status === "failed" || run.status === "cancelled";
}

function summaryProgressFromParts(parts = []) {
  return {
    total: parts.length,
    completed: parts.filter((part) => part.status === "completed").length,
    failed: parts.filter((part) => part.status === "failed").length,
    running: parts.filter((part) => part.status === "running").length
  };
}

function sourceTraceFromSummaryParts(parts = []) {
  return parts
    .map((part) => {
      const trace = part.trace_summary || {};
      if (!trace || typeof trace !== "object") return null;
      if (!Number(trace.evidence_packet_count || 0) && !trace.target_subject && !trace.field_material_mode) return null;
      return {
        part_key: part.part_key,
        parent_key: part.parent_key || "",
        stage: part.stage,
        status: part.status,
        field_name: trace.field_name || inferFieldNameFromPartKey(part.part_key),
        batch: Number(trace.batch || 1),
        total_batches: Number(trace.total_batches || 1),
        evidence_packet_count: Number(trace.evidence_packet_count || 0),
        source_types: trace.source_types || {},
        chapters: trace.chapters || { count: 0, sample: [] },
        categories: trace.categories || {},
        fact_types: trace.fact_types || {},
        subjects: Array.isArray(trace.subjects) ? trace.subjects : [],
        related_subjects: Array.isArray(trace.related_subjects) ? trace.related_subjects : [],
        target_subject: String(trace.target_subject || ""),
        target_evidence_count: Number(trace.target_evidence_count || 0),
        field_material_mode: String(trace.field_material_mode || ""),
        prompt_overhead_chars: Number(trace.prompt_overhead_chars || 0),
        material_chars: Number(trace.material_chars || 0),
        trimmed_by_budget: Boolean(trace.trimmed_by_budget),
        omitted_by_budget: Number(trace.omitted_by_budget || 0),
        field_merge_mode: String(trace.field_merge_mode || ""),
        field_merge_batch_count: Number(trace.field_merge_batch_count || 0),
        field_merge_model_used: Boolean(trace.field_merge_model_used),
        field_merge_fallback_reason: String(trace.field_merge_fallback_reason || ""),
        merged_value_chars: Number(trace.merged_value_chars || 0),
        fallback_used: Boolean(trace.fallback_used),
        fallback_reason: String(trace.fallback_reason || "")
      };
    })
    .filter(Boolean);
}

function sourceTraceSummary(traces = []) {
  const sourceTypes = new Map();
  const categories = new Map();
  const chapters = new Set();
  const subjects = [];
  let targetSubject = "";
  let targetEvidenceCount = 0;
  const preferred = traces.some((trace) => trace.stage === "json_field_batch")
    ? traces.filter((trace) => trace.stage === "json_field_batch")
    : traces.filter((trace) => trace.part_key !== "json.final.merge" || traces.length === 1);
  for (const trace of preferred) {
    mergeCountMap(sourceTypes, trace.source_types);
    mergeCountMap(categories, trace.categories);
    subjects.push(...(trace.subjects || []));
    if (!targetSubject && trace.target_subject) targetSubject = trace.target_subject;
    targetEvidenceCount += Number(trace.target_evidence_count || 0);
    for (const chapterIndex of trace.chapters?.sample || []) {
      const number = Number(chapterIndex || 0);
      if (Number.isFinite(number) && number > 0) chapters.add(number);
    }
    if (trace.chapters?.min) chapters.add(Number(trace.chapters.min));
    if (trace.chapters?.max) chapters.add(Number(trace.chapters.max));
  }
  const chapterList = [...chapters].sort((left, right) => left - right);
  return {
    parts: traces.length,
    evidence_packet_count: preferred.reduce((sum, trace) => sum + Number(trace.evidence_packet_count || 0), 0),
    source_types: Object.fromEntries(sourceTypes),
    categories: Object.fromEntries(categories),
    chapters: {
      count: chapterList.length,
      min: chapterList[0] || null,
      max: chapterList[chapterList.length - 1] || null,
      sample: compactChapterSample(chapterList)
    },
    subjects: uniqueCompact(subjects, 12),
    target_subject: targetSubject,
    target_evidence_count: targetEvidenceCount,
    trimmed_by_budget: preferred.some((trace) => trace.trimmed_by_budget),
    omitted_by_budget: preferred.reduce((sum, trace) => sum + Number(trace.omitted_by_budget || 0), 0)
  };
}

function inferFieldNameFromPartKey(partKey) {
  const match = String(partKey || "").match(/^json\.([^.]+)\./);
  return match?.[1] || "final";
}
