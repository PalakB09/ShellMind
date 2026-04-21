import { getLatestCommandRecord } from '../context/command-history.js';
import { detectOS } from '../os-adapter/index.js';
import { parseIntent as parseAIIntent } from '../intent/index.js';
import { parseUserIntent } from './parser.js';
import { sanitizeIntent } from './sanitizer.js';
import { buildDeterministicIntent } from './transformers.js';
import { validateSteps } from './validator.js';

export async function buildExecutionIntent(instruction, options = {}) {
  const cwd = options.cwd || process.cwd();
  const os = options.os || detectOS();
  const history = options.history || [];
  const latestRecord = options.latestRecord || getLatestCommandRecord(cwd);

  const parsedIntent = parseUserIntent(instruction);
  let intent = buildDeterministicIntent(parsedIntent, { cwd, os, latestRecord });
  let source = intent ? 'deterministic' : 'ai';

  if (!intent) {
    intent = await parseAIIntent(instruction, history);
  }

  if (!intent) {
    return { intent: null, source };
  }

  const sanitizedIntent = sanitizeIntent(intent);
  sanitizedIntent.__source = source;
  const validation = validateSteps(sanitizedIntent.steps || []);

  return {
    intent: sanitizedIntent,
    source,
    validation,
  };
}
