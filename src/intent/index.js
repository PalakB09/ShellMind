// Intent Engine — parses natural language into structured intent via AI router.
// REDESIGNED: supports both SIMPLE (single command) and COMPLEX (JSON plan) AI output.
import chalk from 'chalk';
import ora from 'ora';
import { callAI, callAISimple } from '../ai/router.js';
import { getSystemInfo } from '../os-adapter/index.js';
import { buildContextSummary } from '../context/index.js';
import { formatLatestCommandContext } from '../context/command-history.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

// ─── System Prompt ────────────────────────────────────────

/**
 * Build the system prompt. Contains OS info, project context, and strict output rules.
 * Supports both SIMPLE (single command) and COMPLEX (JSON plan) output formats.
 */
function buildSystemPrompt() {
  const sys = getSystemInfo();
  const ctx = buildContextSummary();
  const shellName = sys.os === 'windows' ? 'PowerShell' : sys.shell;

  return `You are a terminal command generator for ${sys.os} (${shellName}).

## Environment
- OS: ${sys.os}
- Shell: ${shellName}
- User: ${sys.user}
- CWD: ${sys.cwd}

## Project Context
${ctx}

## Latest Real Command Output
${formatLatestCommandContext()}

## Output Format — STRICT

For SIMPLE tasks (single step):
Respond with ONLY the shell command. Nothing else.
Example: git status

For COMPLEX tasks (multiple steps — e.g. add + commit + push, docker cleanup, db reset):
Respond with ONLY valid JSON in this exact schema:
{"intent":"brief description","steps":[{"command":"cmd1","description":"what it does"},{"command":"cmd2","description":"what it does"}]}

## Absolute Rules
1. No explanations. No markdown. No code fences. No prose.
2. You MUST use previous command output when the user refers to prior results. Never hallucinate filenames, process ids, paths, branches, or ports.
3. If user input is required (e.g. commit message, branch name), use <placeholder> syntax.
4. Use ${shellName}-compatible syntax only.
5. For multi-step tasks, ALWAYS use the JSON format with all steps explicit.
6. Return the simplest correct command — do not chain steps with && in FORMAT A when FORMAT B applies.
7. If a previous command failed, read the error carefully and produce a DIFFERENT, corrected command. Never repeat a command that already failed.
${shellName === 'PowerShell' ? `
## PowerShell Quick Reference (MEMORIZE — do not hallucinate)
- File size property:       .Length        (NOT .Size — Size does not exist)
- Folder total size:        Get-ChildItem -Path <dir> -Recurse -File | Measure-Object -Property Length -Sum
- Free disk space:          Get-PSDrive C | Select-Object Used,Free
- Running processes:        Get-Process | Sort-Object CPU -Descending | Select-Object -First 10
- Kill a process:           Stop-Process -Name <name> -Force
- Environment variable:     $env:VAR_NAME
- List directory:           Get-ChildItem -Path <dir>
- Check if path exists:     Test-Path <path>
- File content:             Get-Content <file>
- Copy file:                Copy-Item <src> <dst>
- Delete file:              Remove-Item <path>
- Current directory:        (Get-Location).Path
- String format:            "text {0}" -f value
` : ''}`;
}

// ─── Response Parser ──────────────────────────────────────

/**
 * Parse the raw AI response into a structured intent object.
 *
 * Accepts two formats:
 *   SIMPLE — A single shell command string
 *   COMPLEX — A JSON object: { intent, steps: [{ command, description }] }
 *
 * @param {string} text - Raw AI response
 * @param {string} instruction - Original user instruction (for intent label fallback)
 * @returns {object} Normalized intent object for the pipeline
 */
function parseAIResponse(text, instruction) {
  let cleaned = text.trim();

  if (!cleaned) {
    throw new Error('AI returned an empty response.');
  }

  // Strip markdown code fences if the model aggressively wraps output
  cleaned = cleaned.replace(/^```[a-z]*\n/i, '').replace(/\n```$/, '').trim();

  // Strip inline backtick wrapping — small models (e.g. llama3.2:1b) often
  // return commands like `git add .` instead of plain: git add .
  // Also handles triple-backtick single-line: ```git add .```
  if (/^`{1,3}[^`]/.test(cleaned) && /[^`]`{1,3}$/.test(cleaned)) {
    cleaned = cleaned.replace(/^`{1,3}/, '').replace(/`{1,3}$/, '').trim();
  }

  // Strip leading shell prompt characters ($ or >) that models sometimes prepend
  cleaned = cleaned.replace(/^[$>]\s+/, '').trim();

  // Attempt 1: JSON plan (COMPLEX format)
  if (cleaned.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.intent && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        return {
          intent: parsed.intent,
          steps: parsed.steps.map(s => ({
            command: (s.command || '').trim(),
            description: (s.description || s.command || '').trim(),
            requiresInput: (s.command || '').includes('<') && (s.command || '').includes('>'),
          })).filter(s => s.command),
          needsMoreInfo: false,
          question: null,
        };
      }
    } catch {
      throw new Error('AI returned malformed JSON instead of a valid command.');
    }
  }

  // Attempt 2: Single-line command (SIMPLE format)
  // Be lenient with models that add a leading newline, trailing whitespace, or bash comments
  const lines = cleaned.split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  const firstLine = lines[0];

  if (!firstLine) {
    throw new Error('AI returned an empty command.');
  }

  if (firstLine === '{' || firstLine === '}' || firstLine.startsWith('{"') || firstLine.startsWith('[')) {
    throw new Error('AI returned malformed JSON instead of a valid command.');
  }

  // Reject obvious prose responses — catch common hallucination patterns.
  // Rule: a valid shell command will NEVER start with a natural-language article,
  // preposition, or English sentence opener.
  const prosePatterns = [
    // Classic giveaways
    /^(here is|here's|to do|you can|i'll|i will|let me|sure,|okay,|ok,|of course)/i,
    /^```/,
    // Natural-language sentence openers that can never be a shell command
    /^(in |the |this |these |those |a |an |with |for |when |if |note |please |you |we |it |by |as |at )/i,
    // Prose giveaway: sentence ends with a period and continues (e.g. "foo. Bar baz.")
    /\.\s+[A-Z]/,
    // Contains backtick-wrapped word that is itself a command (model explaining, not executing)
    /`[A-Za-z-]+`.*\breturns\b/i,
    /\breturns\b.*\bcollection\b/i,
    /\brepresent\b|\battribute\b|\bsubdirector/i,
  ];
  if (prosePatterns.some(p => p.test(firstLine) || p.test(cleaned))) {
    throw new Error(`AI returned prose instead of a command: "${firstLine.substring(0, 80)}"`);
  }

  // Final cleanup: strip any remaining inline backticks or prompt chars from the command
  let command = firstLine
    .replace(/^`{1,3}/, '').replace(/`{1,3}$/, '')
    .replace(/^[$>]\s+/, '')
    .trim();

  return {
    intent: instruction,
    steps: [{
      command,
      description: command,
      requiresInput: command.includes('<') && command.includes('>'),
    }],
    needsMoreInfo: false,
    question: null,
  };
}

// ─── Main Parser ──────────────────────────────────────────

/**
 * Parse a natural language instruction into a structured, executable intent.
 *
 * On retry, passes an explicit correction prompt to the AI so it knows why
 * the previous response was rejected.
 *
 * @param {string} instruction - The user's natural language input
 * @param {Array<{role: string, content: string}>} [conversationHistory] - Chat context
 * @returns {Promise<object|null>} Parsed intent or null on failure
 */
export async function parseIntent(instruction, conversationHistory = []) {
  const systemPrompt = buildSystemPrompt();
  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const spinner = ora({
      text: attempt === 0
        ? chalk.cyan('Planning...')
        : chalk.cyan(`Replanning (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`),
      spinner: 'dots',
    }).start();

    try {
      const messages = conversationHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));

      if (attempt > 0 && lastError) {
        // Self-correction: tell the AI exactly what was wrong
        messages.push({
          role: 'user',
          content: `Your previous response was invalid and was rejected.\nReason: ${lastError.message}\nReturn ONLY a shell command or valid JSON plan. No explanations.`,
        });
      } else {
        messages.push({ role: 'user', content: instruction });
      }

      const result = await callAI(systemPrompt, messages, {
        silent: true,
        validateResponse: (response) => {
          parseAIResponse(response, instruction);
          return true;
        },
      });

      spinner.stop();

      if (!result.success) {
        throw new Error(result.error || 'All AI providers failed');
      }

      return parseAIResponse(result.content, instruction);

    } catch (error) {
      spinner.stop();
      lastError = error;

      // Only break immediately if no provider is configured/reachable at all.
      // 'Unusable output' errors are retryable — the model just needs another attempt.
      const isFatal = (error.message || '').includes('No AI provider reachable');
      if (isFatal) break;

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    }
  }

  // Surface the final failure clearly
  const msg = lastError?.message || 'Unknown error';
  if (msg.includes('No AI provider reachable')) {
    console.error(chalk.yellow('\n⚠  No AI provider reachable. Ensure Ollama is running or run `ai init` to configure Gemini.\n'));
  } else {
    console.error(chalk.red(`\n✗  Could not generate a valid command after ${MAX_RETRIES + 1} attempts.\n   Reason: ${msg}\n`));
  }

  return null;
}

/**
 * Parse a corrected intent after a real shell command failure.
 *
 * Instead of wrapping the error in a new free-text instruction (which the AI
 * treats as a fresh request and hallucinates), this injects the original
 * command + the real shell stderr as prior conversation turns so the model
 * sees exactly what went wrong before generating its corrected answer.
 *
 * @param {string} originalInstruction - The user's original natural-language goal
 * @param {string} failedCommand       - The shell command that failed
 * @param {string} stderr              - The raw stderr from the failed command
 * @returns {Promise<object|null>}
 */
export async function parseIntentWithErrorContext(originalInstruction, failedCommand, stderr) {
  const errorHistory = [
    // Simulate the prior exchange so the model has full context
    { role: 'user',      content: originalInstruction },
    { role: 'assistant', content: failedCommand },
    {
      role: 'user',
      content: `That command failed with this error:\n${(stderr || '').substring(0, 600)}\n\nPlease provide a corrected command that achieves the original goal. Output ONLY the corrected shell command or JSON plan — no explanations.`,
    },
  ];
  return parseIntent(originalInstruction, errorHistory);
}

// ─── Error Explainer ──────────────────────────────────────

/**
 * Ask the AI to diagnose a command failure and suggest a fix.
 * Uses simple mode — no structured output required here.
 */
export async function explainError(command, stderr, stdout = '') {
  const sys = getSystemInfo();
  const spinner = ora({ text: chalk.cyan('Analyzing error...'), spinner: 'dots' }).start();

  try {
    const systemPrompt = 'You are a helpful terminal assistant. Explain errors in 1-2 sentences and suggest a concrete fix. Be concise and direct. No markdown.';
    const userMessage = `Command: ${command}\nOS: ${sys.os}\nStderr: ${(stderr || '').substring(0, 500)}\nStdout: ${(stdout || '').substring(0, 200)}`;

    const result = await callAISimple(systemPrompt, userMessage, { silent: true });
    spinner.stop();
    return result.success ? result.content : `Could not analyze: ${result.error}`;
  } catch (error) {
    spinner.stop();
    return `Could not analyze: ${error.message}`;
  }
}
