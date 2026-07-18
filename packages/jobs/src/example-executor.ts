import type { ClaimedStep } from "./step-leases.js";

export interface StepExecutor {
  execute(claim: ClaimedStep): Promise<unknown>;
}

export class ExampleExecutor implements StepExecutor {
  async execute(claim: ClaimedStep): Promise<unknown> {
    if (claim.kind !== "example") throw new Error(`Unsupported step kind: ${claim.kind}`);
    return {
      kind: claim.kind,
      position: claim.position,
      attemptNo: claim.attemptNo,
    };
  }
}
