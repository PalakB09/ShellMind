import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDeleteOldestCommand, buildStageCommand, extractFileEntriesFromOutput, filterEntries } from '../../src/context/output-parser.js';

test('extracts filenames from plain stdout', () => {
  const entries = extractFileEntriesFromOutput('file1.js\nscripts/setup.sh\napp.js\n');
  assert.deepEqual(entries.map((entry) => entry.path), ['file1.js', 'scripts/setup.sh', 'app.js']);
});

test('filters filenames using natural language exclusions', () => {
  const entries = extractFileEntriesFromOutput('file1.js\nscripts/setup.sh\napp.js\n');
  const filtered = filterEntries(entries, 'stage all files except scripts');
  assert.deepEqual(filtered.map((entry) => entry.path), ['file1.js', 'app.js']);
});

test('filters filenames using only extension rules', () => {
  const entries = extractFileEntriesFromOutput('file1.js\nscripts/setup.sh\napp.ts\n');
  const filtered = filterEntries(entries, 'only js files');
  assert.deepEqual(filtered.map((entry) => entry.path), ['file1.js']);
});

test('buildStageCommand uses only real extracted files', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-stage-'));
  fs.writeFileSync(path.join(cwd, 'file1.js'), '1');
  fs.writeFileSync(path.join(cwd, 'app.js'), '2');
  const command = buildStageCommand([
    { path: 'file1.js' },
    { path: 'app.js' },
  ], cwd);
  assert.equal(command, 'git add file1.js app.js');
});

test('extractor drops non-path noise tokens', () => {
  const entries = extractFileEntriesFromOutput('src/app.js\nand/or\nstatus: success\n');
  assert.deepEqual(entries.map((entry) => entry.path), ['src/app.js']);
});

test('buildStageCommand ignores missing noise entries', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-stage-noise-'));
  fs.writeFileSync(path.join(cwd, 'README.md'), '1');
  const command = buildStageCommand([
    { path: 'README.md' },
    { path: 'and/or' },
  ], cwd);
  assert.equal(command, 'git add README.md');
});

test('buildDeleteOldestCommand picks oldest files from extracted set', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cli-oldest-'));
  const older = path.join(cwd, 'a.txt');
  const newer = path.join(cwd, 'b.txt');
  fs.writeFileSync(older, 'a');
  fs.writeFileSync(newer, 'b');
  fs.utimesSync(older, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
  fs.utimesSync(newer, new Date('2021-01-01T00:00:00Z'), new Date('2021-01-01T00:00:00Z'));

  const command = buildDeleteOldestCommand([{ path: 'a.txt' }, { path: 'b.txt' }], cwd, 'linux', 1);
  assert.equal(command, 'rm -f a.txt');
});
