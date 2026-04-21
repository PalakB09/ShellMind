import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseLocalIntent } from '../../src/intent/local.js';

test('context understanding stages all except test files', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-local-intent-'));
  fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
  fs.mkdirSync(path.join(cwd, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'src', 'app.js'), '1');
  fs.writeFileSync(path.join(cwd, 'tests', 'app.test.js'), '2');
  fs.writeFileSync(path.join(cwd, 'README.md'), '3');

  const intent = parseLocalIntent('stage all except test', {
    cwd,
    latestRecord: {
      extractedFiles: [
        { path: 'src/app.js', kind: 'js', extension: 'js' },
        { path: 'tests/app.test.js', kind: 'test', extension: 'js' },
        { path: 'README.md', kind: 'md', extension: 'md' },
      ],
    },
  });

  assert.equal(intent.steps[0].command, 'git add src/app.js README.md');
});

test('delete oldest files uses previous output instead of inventing names', () => {
  const intent = parseLocalIntent('delete oldest files', {
    cwd: process.cwd(),
    latestRecord: {
      extractedFiles: [],
    },
  });

  assert.equal(intent, null);
});

test('kill process on port uses windows command shape', () => {
  const intent = parseLocalIntent('kill process on port 3000', { os: 'windows' });
  assert.match(intent.steps[0].command, /Get-NetTCPConnection -LocalPort 3000/);
});

test('kill process on port uses unix command shape', () => {
  const intent = parseLocalIntent('kill process on port 3000', { os: 'linux' });
  assert.equal(intent.steps[0].command, 'lsof -ti tcp:3000 | xargs kill -9');
});
