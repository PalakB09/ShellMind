import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildExecutionIntent } from '../../src/pipeline/index.js';

test('integration builds deterministic git status command without AI', async () => {
  const result = await buildExecutionIntent('show status of git', {
    history: [],
    latestRecord: null,
  });

  assert.equal(result.source, 'deterministic');
  assert.equal(result.intent.steps[0].command, 'git status');
  assert.equal(result.validation.valid, true);
});

test('integration builds deterministic js listing command without AI', async () => {
  const result = await buildExecutionIntent('list all .js files', {
    history: [],
    latestRecord: null,
  });

  assert.equal(result.source, 'deterministic');
  assert.match(result.intent.steps[0].command, /Get-ChildItem -Recurse -File -Filter \*\.js|find \. -type f -name '\*\.js'/);
  assert.equal(result.validation.valid, true);
});

test('integration stages filtered files from real previous output', async () => {
  const cwd = process.cwd();
  const result = await buildExecutionIntent('stage all except scripts', {
    cwd,
    latestRecord: {
      extractedFiles: [
        { path: 'README.md', kind: 'md', extension: 'md' },
        { path: 'scripts/setup.sh', kind: 'scripts', extension: 'sh' },
        { path: 'package.json', kind: 'json', extension: 'json' },
      ],
    },
  });

  assert.equal(result.source, 'deterministic');
  assert.equal(result.intent.steps[0].command, 'git add README.md package.json');
});

test('integration drops junk tokens from previous output before staging', async () => {
  const cwd = process.cwd();
  const result = await buildExecutionIntent('add stage files except logs', {
    cwd,
    latestRecord: {
      extractedFiles: [
        { path: 'README.md', kind: 'md', extension: 'md' },
        { path: 'and/or', kind: 'file', extension: '' },
      ],
    },
  });

  assert.equal(result.source, 'deterministic');
  assert.equal(result.intent.steps[0].command.includes('and/or'), false);
});

test('integration stages from git status when no prior terminal context exists', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-git-stage-'));
  fs.writeFileSync(path.join(cwd, 'README.md'), '1');
  fs.writeFileSync(path.join(cwd, 'app.log'), '2');
  fs.writeFileSync(path.join(cwd, 'package.json'), '{}');

  const result = await buildExecutionIntent('add stage files except logs', {
    cwd,
    latestRecord: null,
  });

  assert.equal(result.source, 'deterministic');
  assert.equal(result.intent.steps[0].command.includes('README.md'), true);
  assert.equal(result.intent.steps[0].command.includes('package.json'), true);
  assert.equal(result.intent.steps[0].command.includes('app.log'), false);
});
