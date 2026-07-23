# Phase 5 Performance Report Schema

`phase5-load-report-v1`记录一次本地受控容量测试的环境、数据规模、原始样本、阈值结果和队列优先级证据，不代表生产容量承诺

## Reproduction

运行专用 suite 并保留机器可读报告

```bash
npm run test:phase5:scale
```

该命令写入 `.artifacts/phase5-load-report.json`

同时保留 Vitest raw JSON artifact

```bash
npm run test:phase5:scale -- --reporter=json --outputFile=.artifacts/phase5-scale.json
```

## Top-Level Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `"phase5-load-report-v1"` | 报告结构版本 |
| `status` | `"PASS" \| "FAIL"` | 全部 latency 与 priority checks 的汇总结果 |
| `server` | object | CPU、总内存字节数、Node 与 PostgreSQL 版本 |
| `dataset` | object | 测量数据库中的 books、chapters 与 facts 计数 |
| `warmupSeconds` | number | 未计入 raw samples 的预热耗时 |
| `durationSeconds` | number | 20 个 browse loops、背景 rebuild 与 10 个 submissions 的测量耗时 |
| `browse` | object | 固定 `users: 20` 与 browse loop nearest-rank p95 |
| `submit` | object | 固定 `users: 10` 与 query submission nearest-rank p95 |
| `statusPropagationP95Ms` | number | 从 submission 开始到 authenticated job list 可见的 nearest-rank p95 |
| `rawSamplesMs` | object | browse、submit 与 status propagation 的原始毫秒样本 |
| `thresholdsMs` | object | 测量时使用的已批准阈值 |
| `priority` | object | interactive 是否先于 queued background work，以及 running step 是否未被中断 |
| `checks` | object | `browse`、`submit`、`statusPropagation` 与 `interactivePriority` 的显式 PASS/FAIL |

## Measurement Definitions

每个 browse sample 是一个独立认证用户依次读取 book list、book detail、index group list、20 条 fact review 与 analysis readiness 的完整 loop 耗时

每个 submit sample 只测量通过真实 HTTP API 创建 Query turn 和 job 的请求耗时，preview 在计时前执行

每个 status propagation sample 从 submit 请求开始计时，直到同一认证用户通过真实 job list API 看见对应 job

背景工作使用真实 `library-rebuild` job、`library-rebuild-book` steps、PostgreSQL outbox 与 Worker background queue，controlled barrier 只暂停已领取的第一个 step

priority check 要求全部 interactive Query attempts 在其他 queued rebuild steps 仍为零 attempts 时开始，并要求 barrier 中已 running 的 rebuild attempt 保持 running

controlled provider 只返回固定 analysis summary，不访问真实 Dify、生产流量、正式数据或凭证

## Percentile Contract

nearest-rank p95 对样本升序排序后选择排名 `ceil(0.95 * n)` 的值，排名从 1 开始

空样本无 percentile，runner 会抛出 `p95 requires at least one sample`

## Accepted Thresholds

| Check | PASS condition |
| --- | --- |
| Browse | p95 `< 500ms` |
| Submit | p95 `< 1000ms` |
| Status propagation | p95 `< 2000ms` |
| Interactive priority | interactive ahead 为 true 且 running step uninterrupted 为 true |

任一条件不满足时报告先以 `status: "FAIL"` 落盘，随后测试断言失败并阻止验收
