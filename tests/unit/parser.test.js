import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUserIntent } from '../../src/pipeline/parser.js';

test('parser converts stage request into deterministic action and filters', () => {
  const parsed = parseUserIntent('stage all except scripts');
  assert.equal(parsed.kind, 'stage_files');
  assert.deepEqual(parsed.filters.excludeTerms, ['scripts']);
});

test('parser converts git status phrasing into deterministic action', () => {
  const parsed = parseUserIntent('show status of git');
  assert.equal(parsed.kind, 'git_status');
});

test('parser converts list all .js files into deterministic list action', () => {
  const parsed = parseUserIntent('list all .js files');
  assert.equal(parsed.kind, 'list_files');
  assert.deepEqual(parsed.filters.includeTerms, ['.js']);
});
