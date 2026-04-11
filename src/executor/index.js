// Executor — runs shell commands via child_process, streams output, captures results.
// HARDENED: command timeout, output size cap, spawn error handling, encoding fixes.
import { spawn } from 'child_process';
import chalk from 'chalk';
import { getShellConfig } from '../os-adapter/index.js';

const DEFAULT_TIMEOUT_MS = 120_000;  // 2 minute timeout per command
const MAX_OUTPUT_SIZE = 1_000_000;   // ~1MB output cap per stream

/**
 * Execute a single shell command.
 * Streams stdout/stderr in real-time and captures the result.
 *
 * @param {string} command - The shell command string to run
 * @param {object} options
 * @param {string} [options.cwd] - Working directory (defaults to process.cwd())
 * @param {boolean} [options.silent] - If true, suppress output streaming
 * @param {number} [options.timeout] - Timeout in ms (default 120s)
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string, success: boolean, timedOut: boolean}>}
 */
export function executeCommand(command, options = {}) {
  const { cwd = process.cwd(), silent = false, timeout = DEFAULT_TIMEOUT_MS } = options;
  const { shellPath, shellFlag } = getShellConfig();

  return new Promise((resolve) => {
    let child;

    try {
      child = spawn(shellPath, [shellFlag, command], {
        cwd,
        env: { ...process.env },
        stdio: ['inherit', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (spawnErr) {
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: `Failed to spawn process: ${spawnErr.message}`,
        success: false,
        timedOut: false,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    // Timeout handler
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
        // Force kill after 5s if still alive
        setTimeout(() => {
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
        }, 5000);
      } catch { /* ignore */ }
    }, timeout);

    child.stdout.on('data', (data) => {
      const text = data.toString();
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += text;
      } else if (!stdoutTruncated) {
        stdoutTruncated = true;
        stdout += '\n[... output truncated ...]';
      }
      if (!silent) {
        process.stdout.write(chalk.dim(text));
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += text;
      } else if (!stderrTruncated) {
        stderrTruncated = true;
        stderr += '\n[... output truncated ...]';
      }
      if (!silent) {
        process.stderr.write(chalk.yellow(text));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr + '\n' + err.message,
        success: false,
        timedOut: false,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        success: !timedOut && code === 0,
        timedOut,
      });
    });
  });
}

/**
 * Execute a sequence of commands (a plan).
 * Stops on first failure unless `continueOnError` is true.
 *
 * @param {Array<{command: string, description: string}>} steps - The ordered plan steps
 * @param {object} options
 * @param {string} [options.cwd]
 * @param {boolean} [options.continueOnError]
 * @param {number} [options.timeout] - Per-command timeout
 * @returns {Promise<{results: Array<{step: number, command: string, ...result}>, allSucceeded: boolean}>}
 */
export async function executePlan(steps, options = {}) {
  const { cwd, continueOnError = false, timeout } = options;
  const results = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log();
    console.log(chalk.bold.cyan(`▶ Step ${i + 1}/${steps.length}: `) + chalk.white(step.description || step.command));
    console.log(chalk.dim(`  $ ${step.command}`));
    console.log();

    const result = await executeCommand(step.command, { cwd, timeout });

    if (result.timedOut) {
      console.log(chalk.red(`\n✗ Step ${i + 1} timed out after ${(timeout || DEFAULT_TIMEOUT_MS) / 1000}s.`));
    } else if (result.success) {
      console.log(chalk.green(`\n✓ Step ${i + 1} completed successfully.`));
    } else {
      console.log(chalk.red(`\n✗ Step ${i + 1} failed (exit code ${result.exitCode}).`));
      if (result.stderr) {
        // Show first 3 lines of error
        const errorLines = result.stderr.split('\n').slice(0, 3).join('\n');
        console.log(chalk.red(`  Error: ${errorLines}`));
      }
    }

    results.push({
      step: i + 1,
      command: step.command,
      description: step.description,
      ...result,
    });

    if (!result.success && !continueOnError) {
      console.log(chalk.yellow('\n⚠ Execution halted due to failure.'));
      break;
    }
  }

  return {
    results,
    allSucceeded: results.every(r => r.success),
  };
}
