import chalk from 'chalk';

function write(stream, text) {
  if (!text) return;
  stream.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function formatTaggedLine(tag, message, color = chalk.dim) {
  return color(`[${tag}] ${message}`);
}

export function logAI(message) {
  write(process.stderr, formatTaggedLine('ai', message));
}

export function logModel(message) {
  write(process.stderr, formatTaggedLine('model', message));
}

export function logExec(message) {
  write(process.stderr, formatTaggedLine('exec', message));
}

export function logSystem(message) {
  write(process.stderr, formatTaggedLine('system', message));
}

export function logError(message) {
  write(process.stderr, chalk.red(`[error] ${message}`));
}

export function logSuccess(message) {
  write(process.stderr, chalk.green(`[ok] ${message}`));
}

export function writeCommandOutput(text) {
  if (!text) return;
  process.stdout.write(chalk.white(text));
}

export function writeSystemError(text) {
  if (!text) return;
  process.stderr.write(chalk.red(text));
}
