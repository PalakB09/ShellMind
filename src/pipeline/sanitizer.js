const PROMPT_PATTERNS = [
  /^\((?:[^)]+)\)\s*/u,
  /^PS\s+[A-Za-z]:\\[^>\n]*>\s*/u,
  /^[A-Za-z]:\\[^>\n]*>\s*/u,
  /^\$\s+/u,
  /^>\s+/u,
];

export function stripShellPrompt(command = '') {
  let sanitized = `${command}`.replace(/\r/g, '').trim();
  let changed = true;

  while (changed) {
    changed = false;
    for (const pattern of PROMPT_PATTERNS) {
      const next = sanitized.replace(pattern, '');
      if (next !== sanitized) {
        sanitized = next.trim();
        changed = true;
      }
    }
  }

  return sanitized.trim();
}

export function sanitizeCommand(command = '') {
  const firstContentLine = `${command}`
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));

  const stripped = stripShellPrompt(firstContentLine || '');
  return stripped.replace(/^`+|`+$/g, '').trim();
}

export function sanitizeSteps(steps = []) {
  return steps.map((step) => ({
    ...step,
    command: sanitizeCommand(step.command),
    description: step.description || sanitizeCommand(step.command),
  }));
}

export function sanitizeIntent(intent) {
  if (!intent?.steps) return intent;
  return {
    ...intent,
    steps: sanitizeSteps(intent.steps),
  };
}
