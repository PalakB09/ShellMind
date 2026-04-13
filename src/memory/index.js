// Memory Module — save, load, list, and fuzzy-match named commands.
// HARDENED: input validation, atomic writes, name sanitization, markdown processing.
import fs from 'fs';
import path from 'path';
import os from 'os';

const GLOBAL_DIR = path.join(os.homedir(), '.ai-cli');
const GLOBAL_FILE = path.join(GLOBAL_DIR, 'commands.json');
const LOCAL_FILE_NAME = 'ai-commands.md'; // Markdown based storage locally

const MAX_COMMAND_NAME_LENGTH = 50;
const NAME_PATTERN = /^[a-zA-Z0-9_\-]+$/;

// ─── Helpers ───────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getLocalFilePath(dir = process.cwd()) {
  return path.join(dir, LOCAL_FILE_NAME);
}

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

// ─── Global JSON Logic ─────────────────────────────────────

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
  const tempPath = filePath + '.tmp';
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tempPath, filePath);
}

// ─── Local Markdown Logic ──────────────────────────────────

function readMarkdown(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  const commands = {};

  // Split by top-level headers. We ensure a newline precedes `##` to prevent mid-paragraph mismatches
  const sections = content.split(/^##\s+/m);

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i];
    const lines = section.split('\n');
    const name = lines[0].trim();

    let description = '';
    let commandBlock = false;
    let blockCount = 0;
    let cmdLines = [];
    let isMalformed = false;

    for (let j = 1; j < lines.length; j++) {
      const line = lines[j];

      // Match markdown codeblocks (ignoring the language specifier)
      if (line.trim().startsWith('```')) {
        if (!commandBlock) {
          commandBlock = true;
          blockCount++;
          if (blockCount > 1) {
            isMalformed = true;
            break;
          }
        } else {
          commandBlock = false; // Closing fence found
        }
      } else if (commandBlock) {
        cmdLines.push(line);
      } else if (line.trim().length > 0 && !description) {
        // Assume first line of text prior to code block is description
        description = line.trim();
      }
    }

    if (commandBlock) isMalformed = true; // Unclosed block

    if (isMalformed) continue;

    const commandsArray = cmdLines.map(l => l.trim()).filter(Boolean);

    if (commandsArray.length > 0) {
      commands[name] = {
        commands: commandsArray,
        description: description || ''
      };
    }
  }

  return commands;
}

function writeMarkdownSafely(filePath, name, entry) {
  let content = '';
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8');
  } else {
    content = `# AI CLI Commands Reference\n\nThis file contains local automated workflows and macros for this repository. To execute a workflow, run \`ai run <command-name>\` in your terminal.\n\n`;
  }

  let newBlock = `## ${name}\n`;
  if (entry.description) newBlock += `${entry.description}\n\n`;
  newBlock += `\`\`\`bash\n${entry.commands.join('\n')}\n\`\`\`\n`;

  // Matches entirely '## name' down to the start of next '##' or End-Of-File
  const sectionRegex = new RegExp(`^##\\s+${name}\\s*\\n[\\s\\S]*?(?=(^##\\s+)|$)`, 'm');

  if (sectionRegex.test(content)) {
    content = content.replace(sectionRegex, newBlock + '\n');
  } else {
    // Append at EOF cleanly
    if (!content.endsWith('\n\n') && !content.endsWith('\n')) content += '\n\n';
    else if (!content.endsWith('\n\n')) content += '\n';
    content += newBlock + '\n';
  }

  fs.writeFileSync(filePath, content, 'utf-8');
}

function deleteMarkdownSafely(filePath, name) {
  if (!fs.existsSync(filePath)) return false;
  let content = fs.readFileSync(filePath, 'utf-8');

  const sectionRegex = new RegExp(`^##\\s+${name}\\s*\\n[\\s\\S]*?(?=(^##\\s+)|$)`, 'm');
  if (sectionRegex.test(content)) {
    content = content.replace(sectionRegex, '');
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }
  return false;
}

// ─── Core Interface ────────────────────────────────────────

export function saveCommand(name, entry, scope = 'local') {
  validateName(name);

  if (scope === 'global') {
    const data = readJSON(GLOBAL_FILE);
    data[name] = {
      ...entry,
      savedAt: data[name]?.savedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeJSON(GLOBAL_FILE, data);
  } else {
    writeMarkdownSafely(getLocalFilePath(), name, entry);
  }
}

export function loadCommand(name) {
  if (!name || typeof name !== 'string') return null;

  // Local first
  const localData = readMarkdown(getLocalFilePath());
  if (localData[name]) return { ...localData[name], scope: 'local' };

  // Then global
  const globalData = readJSON(GLOBAL_FILE);
  if (globalData[name]) return { ...globalData[name], scope: 'global' };

  return null;
}

export function listCommands() {
  return {
    local: readMarkdown(getLocalFilePath()),
    global: readJSON(GLOBAL_FILE),
  };
}

export function commandExists(name, scope = 'local') {
  if (!name || typeof name !== 'string') return false;

  if (scope === 'global') {
    const data = readJSON(GLOBAL_FILE);
    return !!data[name];
  } else {
    const data = readMarkdown(getLocalFilePath());
    return !!data[name];
  }
}

export function deleteCommand(name, scope = 'local') {
  if (!name || typeof name !== 'string') return false;

  if (scope === 'global') {
    const data = readJSON(GLOBAL_FILE);
    if (!data[name]) return false;
    delete data[name];
    writeJSON(GLOBAL_FILE, data);
    return true;
  } else {
    return deleteMarkdownSafely(getLocalFilePath(), name);
  }
}

// ─── Fuzzy Matching ────────────────────────────────────────

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

export function fuzzyMatchCommand(query, threshold = 5) {
  if (!query || typeof query !== 'string') return [];

  const allCommands = [];

  const localData = readMarkdown(getLocalFilePath());
  for (const [name, entry] of Object.entries(localData)) {
    allCommands.push({ name, entry, scope: 'local' });
  }

  const globalData = readJSON(GLOBAL_FILE);
  for (const [name, entry] of Object.entries(globalData)) {
    if (!localData[name]) {
      allCommands.push({ name, entry, scope: 'global' });
    }
  }

  if (allCommands.length === 0) return [];

  const scored = allCommands.map(cmd => {
    const editDist = levenshtein(query.toLowerCase(), cmd.name.toLowerCase());
    const kwScore = keywordScore(query, cmd.name);
    const descKwScore = cmd.entry.description ? keywordScore(query, cmd.entry.description) : 0;
    const combinedScore = editDist - (kwScore * 3) - (descKwScore * 2);

    return { ...cmd, score: combinedScore, editDistance: editDist };
  });

  return scored
    .filter(s => s.editDistance <= threshold || s.score < threshold)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);
}
