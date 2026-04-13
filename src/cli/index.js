// Compatibility wrapper: routing is owned by src/router/index.js.
// Importers that still call createCLI() get a small facade instead of the old
// command-first router.
import { handleInput } from '../router/index.js';

export function createCLI() {
  return {
    async parseAsync(argv = process.argv) {
      return handleInput(argv.slice(2));
    },
  };
}
