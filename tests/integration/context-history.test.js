import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getLatestCommandRecord, recordExecution } from '../../src/context/command-history.js';
import { parseLocalIntent } from '../../src/intent/local.js';

test('context-aware workflow reuses real previous stdout across runs', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-cwd-'));
  process.env.AI_CLI_HOME = home;
  fs.writeFileSync(path.join(cwd, 'file1.js'), '1');
  fs.mkdirSync(path.join(cwd, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'scripts', 'setup.sh'), '2');
  fs.writeFileSync(path.join(cwd, 'app.js'), '3');

  recordExecution({
    cwd,
    instruction: 'list files',
    steps: [{ command: 'Get-ChildItem -Name', description: 'List files' }],
    results: [{
      step: 1,
      command: 'Get-ChildItem -Name',
      stdout: 'file1.js\nscripts/setup.sh\napp.js\n',
      stderr: '',
      success: true,
      exitCode: 0,
    }],
  });

  const latest = getLatestCommandRecord(cwd);
  const intent = parseLocalIntent('stage all files except scripts', { cwd, latestRecord: latest });

  assert.equal(intent.steps[0].command, 'git add file1.js app.js');
});
