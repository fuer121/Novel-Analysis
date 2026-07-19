import { describe, expect, it } from "vitest";

import { buildL1Signature, buildL2Signature, type FreshnessInputs } from "./freshness.js";

const base: FreshnessInputs = {
  sourceVersion: "source-v1",
  chapterHmac: "chapter-v1",
  promptHash: "prompt-v1",
  workflowDslHash: "workflow-v1",
  adapterContractVersion: "adapter-v1",
  schemaVersion: "schema-v1",
  admissionVersion: "admission-v1",
  indexGroupConfigHash: "group-v1",
  l1Signature: "l1-v1",
};

describe("freshness signatures", () => {
  it.each(["sourceVersion", "chapterHmac", "promptHash", "workflowDslHash", "adapterContractVersion", "schemaVersion"] as const)(
    "makes L1 stale when %s changes",
    (field) => expect(buildL1Signature({ ...base, [field]: `${base[field]}-changed` })).not.toBe(buildL1Signature(base)),
  );

  it.each(["admissionVersion", "indexGroupConfigHash", "l1Signature"] as const)(
    "excludes L2-only field %s from L1",
    (field) => expect(buildL1Signature({ ...base, [field]: `${base[field]}-changed` })).toBe(buildL1Signature(base)),
  );

  it.each(["sourceVersion", "chapterHmac", "promptHash", "workflowDslHash", "adapterContractVersion", "schemaVersion", "admissionVersion", "indexGroupConfigHash", "l1Signature"] as const)(
    "makes L2 stale when %s changes",
    (field) => expect(buildL2Signature({ ...base, [field]: `${base[field]}-changed` })).not.toBe(buildL2Signature(base)),
  );
});
