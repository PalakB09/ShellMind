import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCommand, sanitizeSteps } from '../../src/pipeline/sanitizer.js';
import { validateCommand } from '../../src/pipeline/validator.js';

test('sanitizer strips PowerShell prompt prefixes before execution', () => {
  const sanitized = sanitizeCommand('(base) PS C:\\Users\\Bakshiy\\repo>git status');
  assert.equal(sanitized, 'git status');
});

test('sanitizer strips prompt prefixes in plan steps', () => {
  const steps = sanitizeSteps([{ command: 'PS C:\\repo>git status', description: 'status' }]);
  assert.equal(steps[0].command, 'git status');
});

test('sanitizer strips surrounding backticks', () => {
  const sanitized = sanitizeCommand('`git add README.md`');
  assert.equal(sanitized, 'git add README.md');
});

test('validator rejects leftover prompt artifacts', () => {
  const result = validateCommand('PS C:\\repo>git status');
  assert.equal(result.valid, false);
});

test('validator rejects malformed json fragments', () => {
  const result = validateCommand('{');
  assert.equal(result.valid, false);
});
