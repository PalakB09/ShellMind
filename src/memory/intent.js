// Intent Memory — cache successful AI-generated commands keyed to user instructions.
// IMPROVED: fuzzy matching via Jaccard token similarity so near-identical instructions hit cache.
import fs from 'fs';
import path from 'path';
import os from 'os';

const INTENT_FILE = path.join(os.homedir(), '.ai-cli', 'intent-memory.json');
const FUZZY_THRESHOLD = 0.60; // Jaccard score required to count as a match (0–1)
const MAX_CACHE_ENTRIES = 500; // Prevent unbounded growth

// ─── Persistence ──────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readIntents() {
  if (!fs.existsSync(INTENT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(INTENT_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeIntents(data) {
  ensureDir(path.dirname(INTENT_FILE));
  const tempPath = INTENT_FILE + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, INTENT_FILE);
}

// ─── Text Normalization ───────────────────────────────────

function normalize(instruction) {
  return instruction.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(str) {
  // Split on whitespace and common separators, filter empty
  return new Set(str.toLowerCase().split(/[\s\-_,.]+/).filter(Boolean));
}

// ─── Jaccard Similarity ───────────────────────────────────

/**
 * Compute Jaccard similarity between two strings based on token sets.
 * Score of 1.0 = identical tokens, 0.0 = no overlap.
 *
 * Why Jaccard: it's fast, requires no model, and works well for short
 * natural language command phrases where word order matters less than
 * word presence (e.g. "kill port 3000" ≈ "stop process on port 3000").
 */
function jaccardSimilarity(a, b) {
  const tokA = tokenize(a);
  const tokB = tokenize(b);

  if (tokA.size === 0 && tokB.size === 0) return 1;
  if (tokA.size === 0 || tokB.size === 0) return 0;

  const intersection = [...tokA].filter(t => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;

  return intersection / union;
}

// ─── Public API ───────────────────────────────────────────

/**
 * Check the intent cache for a matching instruction.
 * Checks exact match first, then falls back to fuzzy Jaccard match.
 *
 * @param {string} instruction
 * @returns {object|null} Cached intent or null
 */
export function checkIntentMemory(instruction) {
  if (!instruction || typeof instruction !== 'string') return null;

  const data = readIntents();
  if (Object.keys(data).length === 0) return null;

  const normalized = normalize(instruction);

  // 1. Exact match (fastest path)
  if (data[normalized]) {
    return {
      name: 'Intent Cache',
      description: `Cached: "${instruction}"`,
      steps: data[normalized],
    };
  }

  // 2. Fuzzy match via Jaccard similarity
  let bestKey = null;
  let bestScore = 0;

  for (const key of Object.keys(data)) {
    const score = jaccardSimilarity(normalized, key);
    if (score > bestScore && score >= FUZZY_THRESHOLD) {
      bestScore = score;
      bestKey = key;
    }
  }

  if (bestKey) {
    return {
      name: 'Intent Cache (fuzzy match)',
      description: `Reused cached result for: "${instruction}" (matched: "${bestKey}", score: ${bestScore.toFixed(2)})`,
      steps: data[bestKey],
    };
  }

  return null;
}

/**
 * Cache the steps for a successfully executed AI-generated instruction.
 * Prunes oldest entries if the cache exceeds MAX_CACHE_ENTRIES.
 *
 * @param {string} instruction
 * @param {Array} steps
 */
export function cacheSuccessfulIntent(instruction, steps) {
  if (!instruction || !steps || steps.length === 0) return;

  const data = readIntents();
  const normalized = normalize(instruction);

  data[normalized] = steps.map(s => ({
    command: s.command,
    description: s.description || s.command,
    requiresInput: !!s.requiresInput,
  }));

  // Prune oldest entries (Object.keys preserves insertion order in V8)
  const keys = Object.keys(data);
  if (keys.length > MAX_CACHE_ENTRIES) {
    const toDelete = keys.slice(0, keys.length - MAX_CACHE_ENTRIES);
    for (const k of toDelete) delete data[k];
  }

  writeIntents(data);
}
