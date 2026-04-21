import { detectOS } from '../os-adapter/index.js';
import { getLatestCommandRecord } from '../context/command-history.js';
import { parseUserIntent } from '../pipeline/parser.js';
import { buildDeterministicIntent } from '../pipeline/transformers.js';

export function parseLocalIntent(instruction, options = {}) {
  const cwd = options.cwd || process.cwd();
  const osName = options.os || detectOS();
  const latest = options.latestRecord || getLatestCommandRecord(cwd);
  const parsedIntent = parseUserIntent(instruction);
  return buildDeterministicIntent(parsedIntent, { cwd, os: osName, latestRecord: latest });
}
