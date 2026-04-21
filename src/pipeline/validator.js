const PROMPT_ARTIFACT_PATTERN = /^(\((?:[^)]+)\)\s*)?(PS\s+[A-Za-z]:\\[^>\n]*>|[A-Za-z]:\\[^>\n]*>)/u;
const LABEL_PATTERN = /^(previous command|output|error|status)\s*:/i;

export function validateCommand(command = '') {
  const errors = [];
  const trimmed = `${command}`.trim();

  if (!trimmed) {
    errors.push('Command is empty.');
  }

  if (trimmed.includes('\n')) {
    errors.push('Command must be a single shell command.');
  }

  if (PROMPT_ARTIFACT_PATTERN.test(trimmed)) {
    errors.push('Command contains a shell prompt prefix.');
  }

  if (LABEL_PATTERN.test(trimmed)) {
    errors.push('Command contains context labels instead of executable shell code.');
  }

  if (/^`|`$/.test(trimmed) || trimmed.includes('```')) {
    errors.push('Command contains markdown/backtick wrappers.');
  }

  if (trimmed === '{' || trimmed === '}' || /^\{.*$/.test(trimmed) || /^\[.*$/.test(trimmed)) {
    errors.push('Command looks like malformed JSON instead of shell code.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateSteps(steps = []) {
  const issues = [];

  steps.forEach((step, index) => {
    const result = validateCommand(step.command);
    if (!result.valid) {
      issues.push({
        step: index + 1,
        command: step.command,
        errors: result.errors,
      });
    }
  });

  return {
    valid: issues.length === 0,
    issues,
  };
}
