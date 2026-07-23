export const PHASE5_SCALE_PROFILE = {
  dataset: {
    books: 3,
    chapters: 3_000,
    facts: 70_000,
  },
  warmupIterations: 1,
  browseUsers: 20,
  submitUsers: 10,
  thresholds: {
    browseP95Ms: 500,
    submitP95Ms: 1_000,
    statusPropagationP95Ms: 2_000,
  },
} as const;
