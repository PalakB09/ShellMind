import { parseFilterInstruction } from '../context/output-parser.js';

function parsePort(instruction) {
  const match = instruction.match(/\bport\s+(\d{2,5})\b/i);
  return match ? Number(match[1]) : null;
}

function enrichListFilters(normalized, filters) {
  const extensionMatch = normalized.match(/\b(?:all\s+)?(\.[a-z0-9]+|\w+)\s+files?\b/i);
  if (!extensionMatch) return filters;

  const term = extensionMatch[1].toLowerCase();
  if (['all', 'files', 'file', 'contents', 'items'].includes(term)) return filters;

  return {
    ...filters,
    includeTerms: filters.includeTerms?.length ? filters.includeTerms : [term],
  };
}

export function parseUserIntent(instruction = '') {
  const normalized = instruction.trim().toLowerCase();
  const filters = enrichListFilters(normalized, parseFilterInstruction(normalized));

  if (!normalized) {
    return { kind: 'unknown', instruction };
  }

  if (/\bgit\s+status\b|\bshow\s+status\s+of\s+git\b|\bshow\s+git\s+status\b|\bstatus\s+of\s+git\b/i.test(normalized)) {
    return { kind: 'git_status', instruction };
  }

  if (/^(list|show|ls|dir)\s+((all\s+)?((\.[a-z0-9]+|\w+)\s+)?files?|contents?|items?)(\s+here|\s+in\s+this\s+folder)?$/i.test(normalized)) {
    return { kind: 'list_files', instruction, filters };
  }

  if (/^(list|show|find)\s+all\s+(\.[a-z0-9]+|\w+)\s+files?$/i.test(normalized)) {
    return { kind: 'list_files', instruction, filters };
  }

  if (/\bstage\b/i.test(normalized)) {
    return {
      kind: 'stage_files',
      instruction,
      filters,
    };
  }

  if (/\bdelete\b.*\boldest\b/i.test(normalized)) {
    return {
      kind: 'delete_oldest',
      instruction,
      quantity: filters.quantity || 1,
      filters,
    };
  }

  if (/\bkill\b.*\bport\b/i.test(normalized)) {
    return {
      kind: 'kill_port',
      instruction,
      port: parsePort(instruction),
    };
  }

  return { kind: 'unknown', instruction, filters };
}
