import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeterministicIntent } from '../../src/pipeline/transformers.js';

test('golden: git status command remains stable', () => {
  const intent = buildDeterministicIntent({ kind: 'git_status' }, {});
  assert.equal(intent.steps[0].command, 'git status');
});

test('golden: windows port kill command remains stable', () => {
  const intent = buildDeterministicIntent({ kind: 'kill_port', port: 3000 }, { os: 'windows' });
  assert.equal(
    intent.steps[0].command,
    'Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }'
  );
});
