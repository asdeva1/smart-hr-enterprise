// Entry point used by the Kuberns build (it runs `node /app/bootstrap-db-roles.mjs` before migrations).
// The logic lives in the compiled CLI so it is type-checked and tested with the rest of the API.
import './dist/cli/db-roles.js';
