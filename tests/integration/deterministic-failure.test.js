import test from 'node:test';
import assert from 'node:assert/strict';
import { executePlan } from '../../src/executor/index.js';

test('deterministic execution failure does not auto-repair', async () => {
  let repairCalls = 0;
  const runner = async () => ({
    exitCode: 1,
    stdout: '',
    stderr: "fatal: pathspec 'and/or' did not match any files",
    success: false,
    timedOut: false,
  });

  const result = await executePlan(
    [{ command: 'git add README.md and/or', description: 'bad deterministic plan' }],
    {
      runner,
      repairStep: null,
    }
  );

  assert.equal(repairCalls, 0);
  assert.equal(result.results.length, 1);
  assert.equal(result.allSucceeded, false);
});
