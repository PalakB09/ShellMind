import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTaggedLine } from '../../src/cli/format.js';

test('ui formatting keeps system logs tagged and separate', () => {
  const formatted = formatTaggedLine('exec', 'Running: git add app.js', (value) => value);
  assert.equal(formatted, '[exec] Running: git add app.js');
});
