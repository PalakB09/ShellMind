import test from 'node:test';
import assert from 'node:assert/strict';
import { executePlan } from '../../src/executor/index.js';

test('failure recovery retries with corrected command', async () => {
  const runner = async (command) => {
    if (command === 'nonexistent_command_xyz') {
      return { exitCode: 1, stdout: '', stderr: 'not found', success: false, timedOut: false };
    }

    if (command === 'echo fixed') {
      return { exitCode: 0, stdout: 'fixed', stderr: '', success: true, timedOut: false };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  const results = await executePlan(
    [{ command: 'nonexistent_command_xyz', description: 'fail once' }],
    {
      repairStep: async () => ({ command: 'echo fixed', description: 'fixed' }),
      runner,
      timeout: 10000,
    }
  );

  assert.equal(results.allSucceeded, true);
  assert.equal(results.results.length, 2);
  assert.equal(results.results[1].success, true);
  assert.equal(results.results[1].stdout.trim(), 'fixed');
});
