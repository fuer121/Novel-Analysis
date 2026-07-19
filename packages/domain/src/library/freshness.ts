import { createHash } from "node:crypto";

export type FreshnessInputs = {
  sourceVersion: string;
  chapterHmac: string;
  promptHash: string;
  workflowDslHash: string;
  adapterContractVersion: string;
  schemaVersion: string;
  admissionVersion?: string;
  indexGroupConfigHash?: string;
  l1Signature?: string;
};

function signature(fields: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function buildL1Signature(input: FreshnessInputs): string {
  return signature([
    input.sourceVersion,
    input.chapterHmac,
    input.promptHash,
    input.workflowDslHash,
    input.adapterContractVersion,
    input.schemaVersion,
  ]);
}

export function buildL2Signature(input: FreshnessInputs): string {
  return signature([
    input.sourceVersion,
    input.chapterHmac,
    input.promptHash,
    input.workflowDslHash,
    input.adapterContractVersion,
    input.schemaVersion,
    input.admissionVersion ?? "",
    input.indexGroupConfigHash ?? "",
    input.l1Signature ?? "",
  ]);
}
