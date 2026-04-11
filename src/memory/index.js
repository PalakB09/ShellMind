// Memory Module — save, load, list, and fuzzy-match named commands.
// HARDENED: input validation, atomic writes, name sanitization.
import fs from 'fs';
import path from 'path';
import os from 'os';

const GLOBAL_DIR = path.join(os.homedir(), '.ai-cli');
const GLOBAL_FILE = path.join(GLOBAL_DIR, 'commands.json');
const LOCAL_DIR_NAME = '.ai-cli';
const LOCAL_FILE_NAME = 'commands.json';

const MAX_COMMAND_NAME_LENGTH = 50;
const NAME_PATTERN = /^[a-zA-Z0-9_\-]+$/;

// ─── Helpers ───────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  // Atomic write: write to temp file first, then rename
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

function getLocalFilePath(dir = process.cwd()) {
  return path.join(dir, LOCAL_DIR_NAME, LOCAL_FILE_NAME);
}

/**
 * Validate a command name.
 * @param {string} name
 * @throws {Error} if invalid
 */
function validateName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Command name must be a non-empty string.');
  }
  if (name.length > MAX_COMMAND_NAME_LENGTH) {
    throw new Error(`Command name must be ${MAX_COMMAND_NAME_LENGTH} characters or fewer.`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Command name may only contain letters, numbers, hyphens, and underscores.');
  }
}

// ─── Core Save/Load ────────────────────────────────────────

/**
 * Save a named command.
 * @param {string} name - Command alias
 * @param {object} entry - { commands: string[], description: string }
 * @param {'local'|'global'} scope
 */
export function saveCommand(name, entry, scope = 'local') {
  validateName(name);

  const filePath = scope === 'global' ? GLOBAL_FILE : getLocalFilePath();
  const data = readJSON(filePath);

  data[name] = {
    ...entry,
    savedAt: data[name]?.savedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeJSON(filePath, data);
}

/**
 * Load a named command by exact name.
 * Checks local scope first, then global.
 * @param {string} name
 * @returns {object|null}
 */
export function loadCommand(name) {
  if (!name || typeof name !== 'string') return null;

  // Local first
  const localData = readJSON(getLocalFilePath());
  if (localData[name]) return { ...localData[name], scope: 'local' };

  // Then global
  const globalData = readJSON(GLOBAL_FILE);
  if (globalData[name]) return { ...globalData[name], scope: 'global' };

  return null;
}

/**
 * List all saved commands.
 * @returns {{ local: object, global: object }}
 */
export function listCommands() {
  return {
    local: readJSON(getLocalFilePath()),
    global: readJSON(GLOBAL_FILE),
  };
}

/**
 * Delete a named command.
 * @param {string} name
 * @param {'local'|'global'} scope
 * @returns {boolean} whether anything was deleted
 */
export function deleteCommand(name, scope = 'local') {
  if (!name || typeof name !== 'string') return false;

  const filePath = scope === 'global' ? GLOBAL_FILE : getLocalFilePath();
  const data = readJSON(filePath);

  if (!data[name]) return false;
  delete data[name];
  writeJSON(filePath, data);
  return true;
}

// ─── Fuzzy Matching ────────────────────────────────────────

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      matrix[i][j] = a[i - 1] === b[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + 1);
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Simple keyword overlap score.
 */
function keywordScore(query, target) {
  const queryWords = query.toLowerCase().split(/[\s-_]+/).filter(Boolean);
  const targetWords = target.toLowerCase().split(/[\s-_]+/).filter(Boolean);

  if (queryWords.length === 0) return 0;

  let matches = 0;
  for (const qw of queryWords) {
    if (targetWords.some(tw => tw.includes(qw) || qw.includes(tw))) {
      matches++;
    }
  }

  return matches / queryWords.length;
}

/**
 * Fuzzy-find the best matching command name.
 * @param {string} query - The user's query
 * @param {number} threshold - Max Levenshtein distance to consider (default 5)
 * @returns {Array<{name: string, score: number, scope: 'local'|'global', entry: object}>}
 */
export function fuzzyMatchCommand(query, threshold = 5) {
  if (!query || typeof query !== 'string') return [];

  const allCommands = [];

  const localData = readJSON(getLocalFilePath());
  for (const [name, entry] of Object.entries(localData)) {
    allCommands.push({ name, entry, scope: 'local' });
  }

  const globalData = readJSON(GLOBAL_FILE);
  for (const [name, entry] of Object.entries(globalData)) {
    // Skip if same name already in local
    if (!localData[name]) {
      allCommands.push({ name, entry, scope: 'global' });
    }
  }

  if (allCommands.length === 0) return [];

  const scored = allCommands.map(cmd => {
    const editDist = levenshtein(query.toLowerCase(), cmd.name.toLowerCase());
    const kwScore = keywordScore(query, cmd.name);
    // Also match against description
    const descKwScore = cmd.entry.description
      ? keywordScore(query, cmd.entry.description)
      : 0;

    // Combined score (lower is better): edit distance minus keyword bonuses
    const combinedScore = editDist - (kwScore * 3) - (descKwScore * 2);

    return { ...cmd, score: combinedScore, editDistance: editDist };
  });

  return scored
    .filter(s => s.editDistance <= threshold || s.score < threshold)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);
}
