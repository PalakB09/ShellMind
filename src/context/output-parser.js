import fs from 'fs';
import path from 'path';

const FILE_LINE_PATTERN = /^(?:[A-Z?]{1,2}\s+)?([./\\~\w-]+(?:[./\\][./\\~\w-]+)+|\w+\.[A-Za-z0-9]+)$/;
const TIMESTAMP_PATTERN = /(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)/;
const NON_PATH_TOKENS = new Set([
  'and',
  'or',
  'and/or',
  'none',
  'null',
  'output',
  'error',
  'status',
  'success',
  'failure',
]);

function cleanCandidate(candidate) {
  return candidate
    .replace(/^['"]|['"]$/g, '')
    .replace(/^[A-Z?]{1,2}\s+/, '')
    .trim();
}

function looksLikeRealPath(candidate) {
  if (!candidate) return false;
  const normalized = candidate.replace(/\\/g, '/').toLowerCase();
  if (NON_PATH_TOKENS.has(normalized)) return false;
  if (/[<>|*?]/.test(candidate)) return false;
  if (candidate.split('/').some((part) => NON_PATH_TOKENS.has(part.toLowerCase()))) return false;
  return true;
}

function inferKind(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const ext = path.extname(normalized);

  if (normalized.includes('/scripts/') || normalized.startsWith('scripts/')) return 'scripts';
  if (normalized.includes('/test/') || normalized.includes('/tests/')) return 'test';
  if (normalized.includes('/config/') || normalized.includes('/configs/')) return 'config';
  if (ext) return ext.slice(1);
  return 'file';
}

export function extractFileEntriesFromOutput(stdout = '') {
  if (!stdout || typeof stdout !== 'string') return [];

  const seen = new Set();
  const entries = [];
  const lines = stdout.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let filePath = null;
    const directMatch = line.match(FILE_LINE_PATTERN);
    if (directMatch) {
      filePath = cleanCandidate(directMatch[1]);
    } else {
      const tokens = line.split(/\s+/).map(cleanCandidate);
      const matchedToken = tokens.find((token) => FILE_LINE_PATTERN.test(token));
      if (matchedToken) filePath = matchedToken;
    }

    if (!filePath || !looksLikeRealPath(filePath) || seen.has(filePath)) continue;
    seen.add(filePath);

    const timestampMatch = line.match(TIMESTAMP_PATTERN);
    entries.push({
      path: filePath,
      kind: inferKind(filePath),
      extension: path.extname(filePath).slice(1).toLowerCase(),
      timestamp: timestampMatch ? timestampMatch[1] : null,
      sourceLine: line,
    });
  }

  return entries;
}

function parseList(input = '') {
  return input
    .split(/[,\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export function parseFilterInstruction(instruction = '') {
  const lower = instruction.toLowerCase();
  const exceptMatch = lower.match(/(?:except|excluding|without)\s+(.+?)(?:$|(?:\s+but\s+)|(?:\s+and\s+))/);
  const onlyMatch = lower.match(/(?:only|just)\s+(.+?)(?:$|(?:\s+except\s+)|(?:\s+excluding\s+))/);
  const numberMatch = lower.match(/\b(oldest|newest)\s+(\d+)\b/);

  const includeTerms = onlyMatch ? parseList(onlyMatch[1].replace(/\bfiles?\b/g, '')) : [];
  const excludeTerms = exceptMatch ? parseList(exceptMatch[1].replace(/\bfiles?\b/g, '')) : [];

  return {
    includeTerms,
    excludeTerms,
    quantity: numberMatch ? Number(numberMatch[2]) : null,
  };
}

function matchesTerm(entry, term) {
  if (!term) return false;
  const normalized = term.toLowerCase();
  const normalizedPath = entry.path.replace(/\\/g, '/').toLowerCase();
  const normalizedExtension = entry.extension === 'log' ? 'logs' : entry.extension;
  const singular = normalized.endsWith('s') ? normalized.slice(0, -1) : normalized;
  return (
    entry.kind === normalized ||
    entry.kind === singular ||
    entry.extension === normalized.replace(/^\./, '') ||
    normalizedExtension === normalized.replace(/^\./, '') ||
    entry.extension === singular.replace(/^\./, '') ||
    normalizedPath.includes(normalized)
  );
}

export function filterEntries(entries, instruction = '') {
  const { includeTerms, excludeTerms } = parseFilterInstruction(instruction);
  let filtered = [...entries];

  if (includeTerms.length > 0) {
    filtered = filtered.filter((entry) => includeTerms.some((term) => matchesTerm(entry, term)));
  }

  if (excludeTerms.length > 0) {
    filtered = filtered.filter((entry) => !excludeTerms.some((term) => matchesTerm(entry, term)));
  }

  return filtered;
}

function quoteArg(filePath) {
  return /[\s"]/u.test(filePath) ? `"${filePath.replace(/"/g, '\\"')}"` : filePath;
}

export function buildStageCommand(entries, cwd = process.cwd()) {
  const existingEntries = entries.filter((entry) => resolveExistingPath(cwd, entry.path));
  if (!existingEntries.length) return null;
  return `git add ${existingEntries.map((entry) => quoteArg(entry.path)).join(' ')}`;
}

function resolveExistingPath(cwd, entryPath) {
  const fullPath = path.isAbsolute(entryPath) ? entryPath : path.join(cwd, entryPath);
  return fs.existsSync(fullPath) ? fullPath : null;
}

export function buildDeleteOldestCommand(entries, cwd, osName = process.platform === 'win32' ? 'windows' : 'linux', count = 1) {
  const ranked = entries
    .map((entry) => {
      const fullPath = resolveExistingPath(cwd, entry.path);
      if (!fullPath) return null;
      const stats = fs.statSync(fullPath);
      return { ...entry, fullPath, mtimeMs: stats.mtimeMs };
    })
    .filter(Boolean)
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .slice(0, count);

  if (!ranked.length) return null;

  if (osName === 'windows') {
    return `Remove-Item ${ranked.map((entry) => quoteArg(entry.path)).join(', ')}`;
  }

  return `rm -f ${ranked.map((entry) => quoteArg(entry.path)).join(' ')}`;
}
