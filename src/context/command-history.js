import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractFileEntriesFromOutput } from './output-parser.js';

const MAX_HISTORY_ENTRIES = 40;

function getHistoryDir() {
  return path.join(process.env.AI_CLI_HOME || os.homedir(), '.ai-cli');
}

function getHistoryFile() {
  return path.join(getHistoryDir(), 'command-history.json');
}

function ensureDir() {
  const historyDir = getHistoryDir();
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
}

function readHistoryFile() {
  const historyFile = getHistoryFile();
  if (!fs.existsSync(historyFile)) return [];

  try {
    const parsed = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistoryFile(entries) {
  ensureDir();
  const historyFile = getHistoryFile();
  const tempPath = `${historyFile}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(entries, null, 2), 'utf8');
  fs.renameSync(tempPath, historyFile);
}

function normalizeResult(result) {
  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    success: !!result.success,
    exitCode: typeof result.exitCode === 'number' ? result.exitCode : 1,
  };
}

function buildStepRecord({ cwd, instruction, step, result }) {
  const normalized = normalizeResult(result);
  return {
    timestamp: new Date().toISOString(),
    cwd,
    instruction,
    command: step.command,
    description: step.description || step.command,
    output: normalized.stdout,
    error: normalized.stderr || null,
    status: normalized.success ? 'success' : 'failure',
    exitCode: normalized.exitCode,
    extractedFiles: extractFileEntriesFromOutput(normalized.stdout),
  };
}

export function recordExecution({ cwd = process.cwd(), instruction, steps = [], results = [] }) {
  if (!Array.isArray(steps) || !Array.isArray(results) || steps.length === 0 || results.length === 0) {
    return;
  }

  const history = readHistoryFile();
  const newEntries = [];

  for (const result of results) {
    const step = steps[result.step - 1];
    if (!step) continue;
    newEntries.push(buildStepRecord({ cwd, instruction, step, result }));
  }

  const merged = [...history, ...newEntries].slice(-MAX_HISTORY_ENTRIES);
  writeHistoryFile(merged);
}

export function getCommandHistory(cwd = process.cwd()) {
  return readHistoryFile().filter((entry) => entry.cwd === cwd);
}

export function getLatestCommandRecord(cwd = process.cwd()) {
  const history = getCommandHistory(cwd);
  return history[history.length - 1] || null;
}

export function formatLatestCommandContext(cwd = process.cwd()) {
  const latest = getLatestCommandRecord(cwd);
  if (!latest) return 'Previous command: None\nOutput: None\nError: None\nStatus: none';

  return [
    `Previous command: ${latest.command}`,
    `Output: ${latest.output || 'None'}`,
    `Error: ${latest.error || 'None'}`,
    `Status: ${latest.status}`,
  ].join('\n');
}
