import { PgBoss } from "pg-boss";

export type WakeMessage = {
  jobId: string;
  outboxId: string;
};

export interface BossSender {
  send(
    topic: string,
    data: WakeMessage,
    options: { singletonKey: string },
  ): Promise<string | null>;
}

export function createBoss(connectionString: string): PgBoss {
  return new PgBoss(connectionString);
}
