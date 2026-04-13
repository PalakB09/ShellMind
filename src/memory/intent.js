import fs from 'fs';
import path from 'path';
import os from 'os';

const INTENT_FILE = path.join(os.homedir(), '.ai-cli', 'intent-memory.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
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

/**
 * Clean up instruction string for caching (lowercase, strip extra spaces).
 */
function normalize(instruction) {
  return instruction.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Retrieve successful steps mapped to an identical command instruction.
 */
export function checkIntentMemory(instruction) {
  const data = readIntents();
  const normalized = normalize(instruction);
  
  if (data[normalized]) {
    return {
      name: `Intent Cache`,
      description: `Reused successful execution for: "${instruction}"`,
      steps: data[normalized]
    };
  }
  return null;
}

/**
 * Save successful steps executing from AI Generation to skip generation next time.
 */
export function cacheSuccessfulIntent(instruction, steps) {
  if (!instruction || !steps || steps.length === 0) return;
  const data = readIntents();
  const normalized = normalize(instruction);
  
  // Cache the command and description properties directly 
  data[normalized] = steps.map(s => ({
    command: s.command,
    description: s.description || s.command,
    requiresInput: !!s.requiresInput
  }));
  
  writeIntents(data);
}
