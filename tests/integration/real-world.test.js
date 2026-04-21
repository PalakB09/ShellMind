// Real-World Integration Tests
// Tests use real filesystem, real git repo, real command outputs. No hardcoding.
import assert from 'assert';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ─── Test Helpers ─────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ─── Imports ──────────────────────────────────────────────
import { parseUserIntent } from '../../src/pipeline/parser.js';
import { buildDeterministicIntent } from '../../src/pipeline/transformers.js';
import { analyzeCommand, analyzePlan } from '../../src/safety/index.js';
import { sanitizeCommand, sanitizeSteps } from '../../src/pipeline/sanitizer.js';
import { validateCommand, validateSteps } from '../../src/pipeline/validator.js';
import { executeCommand } from '../../src/executor/index.js';
import { getGitStatusEntries, getWorkspaceEntries, detectProject } from '../../src/context/index.js';
import { saveCommand, loadCommand, deleteCommand, listCommands } from '../../src/memory/index.js';
import { getConfig, hasAnyApiKey, hasConfiguredProvider } from '../../src/config/index.js';
import { isOllamaRunning, getOllamaModels, resolveOllamaRuntime } from '../../src/ai/router.js';
import { recordExecution, getLatestCommandRecord } from '../../src/context/command-history.js';

console.log('\n━━━ Real-World Integration Tests ━━━\n');

// ════════════════════════════════════════════════════════════
// A. DETERMINISTIC PIPELINE (no AI needed)
// ════════════════════════════════════════════════════════════
console.log('A. Deterministic Pipeline\n');

test('1. "git status" → parses as git_status kind', () => {
  const result = parseUserIntent('git status');
  assert.strictEqual(result.kind, 'git_status');
});

test('2. "git status" → deterministic intent produces "git status" command', () => {
  const parsed = parseUserIntent('git status');
  const intent = buildDeterministicIntent(parsed, { os: 'windows', cwd: process.cwd() });
  assert.ok(intent, 'Should produce a deterministic intent');
  assert.ok(intent.steps.length > 0, 'Should have steps');
  assert.strictEqual(intent.steps[0].command, 'git status');
});

test('3. "list all js files" → parses as list_files kind', () => {
  const result = parseUserIntent('list all js files');
  assert.strictEqual(result.kind, 'list_files');
});

test('4. "list all js files" → deterministic intent produces file listing command', () => {
  const parsed = parseUserIntent('list all js files');
  const intent = buildDeterministicIntent(parsed, { os: 'windows', cwd: process.cwd() });
  assert.ok(intent, 'Should produce a deterministic intent');
  assert.ok(intent.steps[0].command.includes('.js'), 'Command should filter for .js files');
});

test('5. "kill port 3000" → parses as kill_port kind with port 3000', () => {
  const result = parseUserIntent('kill port 3000');
  assert.strictEqual(result.kind, 'kill_port');
  assert.strictEqual(result.port, 3000);
});

test('6. "kill port 3000" → deterministic intent produces platform-specific kill command', () => {
  const parsed = parseUserIntent('kill port 3000');
  const intent = buildDeterministicIntent(parsed, { os: 'windows', cwd: process.cwd() });
  assert.ok(intent, 'Should produce a deterministic intent');
  assert.ok(intent.steps[0].command.includes('3000'), 'Command should reference port 3000');
});

test('7. "stage all files except test" → parses as stage_files kind', () => {
  const result = parseUserIntent('stage all files except test');
  assert.strictEqual(result.kind, 'stage_files');
});

test('8. Unknown natural language → parses as unknown kind', () => {
  const result = parseUserIntent('show me the disk usage');
  assert.strictEqual(result.kind, 'unknown');
});

// ════════════════════════════════════════════════════════════
// B. SAFETY CLASSIFICATION
// ════════════════════════════════════════════════════════════
console.log('\nB. Safety Classification\n');

test('9. "git status" → classified safe', () => {
  const result = analyzeCommand('git status');
  assert.strictEqual(result.classification, 'safe');
});

test('10. "git push --force" → classified dangerous', () => {
  const result = analyzeCommand('git push --force');
  assert.strictEqual(result.classification, 'dangerous');
});

test('11. "rm -rf /" → classified dangerous', () => {
  const result = analyzeCommand('rm -rf /');
  assert.strictEqual(result.classification, 'dangerous');
});

test('12. "git push" → classified caution', () => {
  const result = analyzeCommand('git push');
  assert.strictEqual(result.classification, 'caution');
});

test('13. "git reset --hard" → classified caution', () => {
  const result = analyzeCommand('git reset --hard');
  assert.strictEqual(result.classification, 'caution');
});

test('14. "echo hello" → classified safe', () => {
  const result = analyzeCommand('echo hello');
  assert.strictEqual(result.classification, 'safe');
});

test('15. Plan with mixed safety → hasDangerousSteps and hasCautionSteps correct', () => {
  const result = analyzePlan([
    { command: 'git status', description: 'status' },
    { command: 'git push', description: 'push' },
  ]);
  assert.strictEqual(result.hasDangerousSteps, false);
  assert.strictEqual(result.hasCautionSteps, true);
});

// ════════════════════════════════════════════════════════════
// C. SANITIZER & VALIDATOR
// ════════════════════════════════════════════════════════════
console.log('\nC. Sanitizer & Validator\n');

test('16. Strips backtick wrapping from commands', () => {
  assert.strictEqual(sanitizeCommand('`git add .`'), 'git add .');
});

test('17. Strips shell prompt prefix', () => {
  assert.strictEqual(sanitizeCommand('$ git status'), 'git status');
});

test('18. Strips PowerShell prompt prefix', () => {
  assert.strictEqual(sanitizeCommand('PS C:\\Users\\test> git status'), 'git status');
});

test('19. Validates empty commands as invalid', () => {
  const result = validateCommand('');
  assert.strictEqual(result.valid, false);
});

test('20. Validates clean command as valid', () => {
  const result = validateCommand('git status');
  assert.strictEqual(result.valid, true);
});

test('21. Validates markdown-wrapped command as invalid', () => {
  const result = validateCommand('```git status```');
  assert.strictEqual(result.valid, false);
});

// ════════════════════════════════════════════════════════════
// D. CONTEXT ENGINE (real filesystem)
// ════════════════════════════════════════════════════════════
console.log('\nD. Context Engine\n');

test('22. detectProject finds package.json in this repo', () => {
  const result = detectProject(process.cwd());
  const hasNode = result.types.some(t => t.type === 'node');
  assert.ok(hasNode, 'Should detect Node.js project');
});

test('23. detectProject detects git repo', () => {
  const result = detectProject(process.cwd());
  assert.ok(result.hasGit, 'Should detect .git directory');
});

test('24. detectProject extracts npm scripts', () => {
  const result = detectProject(process.cwd());
  assert.ok(result.scripts, 'Should have scripts object');
  assert.ok(result.scripts.test, 'Should have a test script');
});

test('25. getGitStatusEntries returns real entries from git', () => {
  const entries = getGitStatusEntries(process.cwd());
  // entries may be empty if working tree is clean — that's valid
  assert.ok(Array.isArray(entries), 'Should return an array');
  if (entries.length > 0) {
    assert.ok(entries[0].path, 'Entry should have a path');
    assert.ok(entries[0].kind, 'Entry should have a kind');
  }
});

test('26. getWorkspaceEntries returns files from this repo', () => {
  const entries = getWorkspaceEntries(process.cwd());
  assert.ok(entries.length > 0, 'Should find files');
  const hasSrc = entries.some(e => e.path.startsWith('src/') || e.path.startsWith('src\\'));
  assert.ok(hasSrc, 'Should include src/ directory entries');
});

// ════════════════════════════════════════════════════════════
// E. COMMAND EXECUTION (real commands)
// ════════════════════════════════════════════════════════════
console.log('\nE. Command Execution\n');

await testAsync('27. Execute "echo hello" succeeds', async () => {
  const result = await executeCommand('echo hello');
  assert.ok(result.success, 'echo should succeed');
  assert.ok(result.stdout.includes('hello'), 'stdout should contain hello');
});

await testAsync('28. Execute invalid command fails', async () => {
  const result = await executeCommand('command_that_does_not_exist_xyz123');
  assert.strictEqual(result.success, false, 'Should fail');
});

await testAsync('29. Execute "git status" succeeds in this repo', async () => {
  const result = await executeCommand('git status');
  assert.ok(result.success, 'git status should succeed');
  assert.ok(result.stdout.length > 0, 'Should have output');
});

// ════════════════════════════════════════════════════════════
// F. MEMORY / WORKFLOWS
// ════════════════════════════════════════════════════════════
console.log('\nF. Memory / Workflows\n');

test('30. Save + load + delete a global workflow', () => {
  const testName = 'test-real-world-temp';
  saveCommand(testName, {
    commands: ['echo test-step-1', 'echo test-step-2'],
    description: 'Temporary test workflow',
  }, 'global');

  const loaded = loadCommand(testName);
  assert.ok(loaded, 'Should load the saved command');
  assert.ok(loaded.commands.includes('echo test-step-1'), 'Should contain the correct command');

  const deleted = deleteCommand(testName, 'global');
  assert.ok(deleted, 'Should delete successfully');

  const afterDelete = loadCommand(testName);
  assert.ok(!afterDelete, 'Should not exist after deletion');
});

test('31. listCommands returns structured result', () => {
  const result = listCommands();
  assert.ok(typeof result.local === 'object', 'Should have local object');
  assert.ok(typeof result.global === 'object', 'Should have global object');
});

// ════════════════════════════════════════════════════════════
// G. CONFIG SYSTEM
// ════════════════════════════════════════════════════════════
console.log('\nG. Config System\n');

test('32. getConfig returns valid config object', () => {
  const config = getConfig();
  assert.ok(config.provider, 'Should have a provider');
  assert.ok(typeof config.models === 'object', 'Should have models object');
  assert.ok(typeof config.apiKeys === 'object', 'Should have apiKeys object');
});

test('33. hasAnyApiKey returns boolean', () => {
  const result = hasAnyApiKey();
  assert.strictEqual(typeof result, 'boolean');
});

test('34. hasConfiguredProvider returns boolean', () => {
  const result = hasConfiguredProvider();
  assert.strictEqual(typeof result, 'boolean');
});

// ════════════════════════════════════════════════════════════
// H. OLLAMA VALIDATION (conditional — skips if not running)
// ════════════════════════════════════════════════════════════
console.log('\nH. Ollama Validation\n');

const ollamaBaseUrl = await isOllamaRunning();

if (ollamaBaseUrl) {
  await testAsync('35. Ollama is running and reachable', async () => {
    assert.ok(ollamaBaseUrl, 'Should return a base URL');
    assert.ok(ollamaBaseUrl.startsWith('http'), 'Should be an HTTP URL');
  });

  await testAsync('36. getOllamaModels returns installed models', async () => {
    const models = await getOllamaModels();
    assert.ok(Array.isArray(models), 'Should return an array');
    assert.ok(models.length > 0, 'Should have at least one model');
  });

  await testAsync('37. resolveOllamaRuntime finds a usable model', async () => {
    const runtime = await resolveOllamaRuntime();
    assert.ok(runtime, 'Should resolve a runtime');
    assert.ok(runtime.model, 'Should have a model name');
    assert.ok(runtime.baseUrl, 'Should have a base URL');
  });

  await testAsync('38. Ollama responds to a real prompt', async () => {
    const { callAISimple } = await import('../../src/ai/router.js');
    const result = await callAISimple(
      'You are a test. Respond with ONLY: OK',
      'say ok',
      { silent: true }
    );
    assert.ok(result.success, 'Should get a successful response');
    assert.ok(result.content.length > 0, 'Response should have content');
    assert.strictEqual(result.provider, 'ollama', 'Should use Ollama');
  });

  await testAsync('39. Ollama generates valid command for "list files"', async () => {
    const { callAISimple } = await import('../../src/ai/router.js');
    const result = await callAISimple(
      'You are a terminal command generator for windows (PowerShell). Respond with ONLY the shell command. No explanations.',
      'list all files in current directory',
      { silent: true }
    );
    assert.ok(result.success, 'Should succeed');
    // Validate it's not prose — should not start with common prose patterns
    const content = result.content.trim();
    assert.ok(!/^(here|to |the |this |i |you )/i.test(content), `Should not be prose: "${content.substring(0, 60)}"`);
  });
} else {
  console.log('  ⊘ Ollama not running — skipping Ollama tests (35-39)');
}

// ════════════════════════════════════════════════════════════
// I. CONTEXT HISTORY PERSISTENCE
// ════════════════════════════════════════════════════════════
console.log('\nI. Context History\n');

await testAsync('40. recordExecution persists to history', async () => {
  const step = { command: 'echo real-world-test', description: 'test' };
  const result = await executeCommand('echo real-world-test');
  recordExecution({
    cwd: process.cwd(),
    instruction: 'test echo',
    steps: [step],
    results: [{ step: 1, command: step.command, ...result }],
  });
  const latest = getLatestCommandRecord(process.cwd());
  assert.ok(latest, 'Should have a latest record');
  assert.strictEqual(latest.command, 'echo real-world-test');
  assert.ok(latest.extractedFiles !== undefined, 'Should have extractedFiles field');
});

// ════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  Failures:');
  for (const f of failures) {
    console.log(`    ✗ ${f.name}: ${f.error}`);
  }
}
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

if (failed > 0) process.exit(1);
