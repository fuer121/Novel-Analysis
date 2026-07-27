import { createDatabase, destroyDatabase } from "@novel-analysis/database";

import { bootstrapFirstAdmin } from "./bootstrap-admin.js";
import { executeFirstAdminBootstrap } from "./bootstrap-admin-command.js";

process.exitCode = await executeFirstAdminBootstrap({
  environment: process.env,
  createDatabase,
  bootstrapAdmin: bootstrapFirstAdmin,
  destroyDatabase,
  writeOutput: (message) => console.log(message),
  writeError: (message) => console.error(message),
});
