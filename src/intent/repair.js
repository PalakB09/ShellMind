import { callAI } from '../ai/router.js';
import { getSystemInfo } from '../os-adapter/index.js';
import { formatLatestCommandContext } from '../context/command-history.js';

export async function repairFailedStep({ failedStep, instruction, cwd = process.cwd() }) {
  if (!failedStep) return null;

  const sys = getSystemInfo();
  const systemPrompt = `You repair failed terminal commands for ${sys.os}.
Return ONLY a single corrected shell command.
Never explain anything.
Use the latest real terminal output.
If you cannot produce a safe correction, return exactly: __NO_FIX__`;

  const userPrompt = [
    `Original goal: ${instruction}`,
    formatLatestCommandContext(cwd),
    `Failed command: ${failedStep.command}`,
    `Stdout: ${failedStep.stdout || 'None'}`,
    `Stderr: ${failedStep.stderr || 'None'}`,
  ].join('\n');

  const result = await callAI(systemPrompt, [{ role: 'user', content: userPrompt }], {
    silent: true,
    validateResponse: (response) => typeof response === 'string' && response.trim().length > 0 && !response.includes('{'),
  });

  if (!result.success) return null;

  const command = result.content.trim();
  if (!command || command === '__NO_FIX__') return null;

  return {
    command,
    description: `Recovered from failure in: ${failedStep.command}`,
    requiresInput: false,
  };
}
