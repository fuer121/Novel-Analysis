import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

type ProcessMessage = { type: string; port?: number; jobId?: string; attemptNo?: number };

export interface ManagedProcess {
  child: ChildProcess;
  logs: string[];
  send(message: object): void;
  waitFor(type: string, timeoutMs?: number): Promise<ProcessMessage>;
  stop(signal?: NodeJS.Signals): Promise<void>;
}

function spawnEntry(entry: string, environment: NodeJS.ProcessEnv): ManagedProcess {
  const logs: string[] = [];
  const messages: ProcessMessage[] = [];
  const child = fork(fileURLToPath(new URL(entry, import.meta.url)), [], {
    execArgv: ["--import", "tsx"],
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout?.on("data", (chunk) => logs.push(String(chunk)));
  child.stderr?.on("data", (chunk) => logs.push(String(chunk)));
  child.on("message", (raw) => messages.push(raw as ProcessMessage));

  function waitFor(type: string, timeoutMs = 10_000): Promise<ProcessMessage> {
    const bufferedIndex = messages.findIndex((message) => message.type === type);
    if (bufferedIndex >= 0) return Promise.resolve(messages.splice(bufferedIndex, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`Timed out waiting for ${type}`)), timeoutMs);
      const onMessage = (raw: unknown) => {
        const message = raw as ProcessMessage;
        if (message.type === type) {
          const index = messages.indexOf(message);
          if (index >= 0) messages.splice(index, 1);
          finish(undefined, message);
        }
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        finish(new Error(`Process exited before ${type}: code=${code} signal=${signal}\n${logs.join("")}`));
      };
      function finish(error?: Error, message?: ProcessMessage) {
        clearTimeout(timeout);
        child.off("message", onMessage);
        child.off("exit", onExit);
        if (error) reject(error);
        else resolve(message!);
      }
      child.on("message", onMessage);
      child.once("exit", onExit);
    });
  }

  return {
    child,
    logs,
    send(message) { child.send(message); },
    waitFor,
    async stop(signal = "SIGTERM") {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      if (signal === "SIGTERM" && child.connected) child.send({ type: "stop" });
      else child.kill(signal);
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          exited,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Process stop timed out")), 5_000);
            timeout.unref();
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
  };
}

async function waitForReady(
  process: ManagedProcess,
  timeoutMs?: number,
): Promise<ProcessMessage> {
  try {
    return await process.waitFor("ready", timeoutMs);
  } catch (startupError) {
    try {
      await process.stop("SIGKILL");
    } catch (cleanupError) {
      throw new AggregateError(
        [startupError, cleanupError],
        "Process startup and cleanup failed",
        { cause: startupError },
      );
    }
    throw startupError;
  }
}

export async function startTestApi(input: {
  databaseUrl: string;
  clientSecret: string;
  suppressReady?: boolean;
  readyTimeoutMs?: number;
}): Promise<ManagedProcess & { origin: string }> {
  const process = spawnEntry("./test-api-main.ts", {
    DATABASE_URL: input.databaseUrl,
    TEST_FEISHU_CLIENT_SECRET: input.clientSecret,
    TEST_SUPPRESS_READY: input.suppressReady ? "true" : "false",
  });
  const ready = await waitForReady(process, input.readyTimeoutMs);
  return { ...process, origin: `http://127.0.0.1:${ready.port}` };
}

export async function startWorker(input: {
  databaseUrl: string;
  mode: "controlled" | "recovery";
  suppressReady?: boolean;
  readyTimeoutMs?: number;
}): Promise<ManagedProcess> {
  const process = spawnEntry("./controlled-worker-main.ts", {
    DATABASE_URL: input.databaseUrl,
    WORKER_MODE: input.mode,
    TEST_SUPPRESS_READY: input.suppressReady ? "true" : "false",
  });
  await waitForReady(process, input.readyTimeoutMs);
  return process;
}
