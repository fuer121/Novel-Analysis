# Legacy Contract Baseline

Date: 2026-07-16

The legacy application remains the behavior reference until each capability is replaced by an approved phase

## Required commands

```bash
npm run test:legacy
npm run lint:legacy
npm run build:legacy
```

## Baseline evidence

- `test/service.test.js` contains 112 Node tests
- Vite builds the root React application
- ESLint checks root `src`, `server`, and `test` JavaScript
- SQLite, in-memory tasks, and Dify adapters remain unchanged in phase 0

## Protected behavior areas

- chapter import batching and normalization
- AES-256-GCM and HMAC storage boundaries
- L1 and L2 freshness signatures
- specialized L2 admission rules
- L2 query recall, chunking, fallback, and trace
- advanced analysis snapshots, merge, and resume

Phase 0 may add contract fixtures and new packages but must not change these behaviors
