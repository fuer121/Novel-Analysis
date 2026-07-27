import { lstat, open, readFile, rm } from "node:fs/promises";

type ProcessAliveProbe = (pid: number) => boolean;

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function prepareWorkerReadiness(markerPath: string): Promise<void> {
  await rm(markerPath, { force: true });
}

export async function markWorkerReady(
  markerPath: string,
  pid = process.pid,
): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Worker PID is invalid");
  const marker = await open(markerPath, "wx", 0o600);
  try {
    await marker.writeFile(`${pid}\n`, "utf8");
    await marker.sync();
  } finally {
    await marker.close();
  }
}

export async function clearWorkerReadiness(markerPath: string): Promise<void> {
  await rm(markerPath, { force: true });
}

export function createReadinessAwareShutdown(options: {
  clearReadiness(): Promise<void>;
  stopResources(): Promise<void>;
}): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;
  return () => {
    shutdownPromise ??= (async () => {
      const errors: unknown[] = [];
      try {
        await options.clearReadiness();
      } catch (error) {
        errors.push(error);
      }
      try {
        await options.stopResources();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw new AggregateError(errors, "Worker readiness and resource shutdown failed");
      }
    })();
    return shutdownPromise;
  };
}

export async function isWorkerReady(
  markerPath: string,
  processAlive: ProcessAliveProbe = defaultProcessAlive,
): Promise<boolean> {
  try {
    const metadata = await lstat(markerPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      return false;
    }
    if (typeof process.getuid === "function" && metadata.uid !== process.getuid()) {
      return false;
    }
    const value = await readFile(markerPath, "utf8");
    if (!/^[1-9]\d*\n$/.test(value)) return false;
    const pid = Number(value.trim());
    return Number.isSafeInteger(pid) && processAlive(pid);
  } catch {
    return false;
  }
}
