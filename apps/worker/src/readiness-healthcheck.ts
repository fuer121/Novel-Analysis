import { isWorkerReady } from "./readiness.js";

const markerPath = process.env.WORKER_READY_FILE ?? "/tmp/novel-worker.ready";
process.exitCode = await isWorkerReady(markerPath) ? 0 : 1;
