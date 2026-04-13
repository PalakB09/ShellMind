// Intent Engine — parses natural language into structured intent via AI router.
// Uses multi-model router: OpenRouter free models → Gemini fallback.
import chalk from 'chalk';
import ora from 'ora';
import { callAI, callAISimple } from '../ai/router.js';
import { getSystemInfo } from '../os-adapter/index.js';
import { buildContextSummary } from '../context/index.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// ─── Schema Validation ────────────────────────────────────

/**
 * Validate and normalize the parsed AI response to a strict schema.
 * Returns a clean object or throws with details.
 */
function validateIntentSchema(parsed) {
  const errors = [];

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('AI response is not an object.');
  }

  // intent — required string
  if (typeof parsed.intent !== 'string' || parsed.intent.trim().length === 0) {
    errors.push('"intent" must be a non-empty string.');
  }

  // steps — required array
  if (!Array.isArray(parsed.steps)) {
    errors.push('"steps" must be an array.');
  } else {
    for (let i = 0; i < parsed.steps.length; i++) {
      const step = parsed.steps[i];
      if (typeof step !== 'object' || step === null) {
        errors.push(`steps[${i}] must be an object.`);
        continue;
      }
      if (typeof step.command !== 'string' || step.command.trim().length === 0) {
        errors.push(`steps[${i}].command must be a non-empty string.`);
      }
      if (step.description !== undefined && typeof step.description !== 'string') {
        errors.push(`steps[${i}].description must be a string if present.`);
      }
      if (step.requiresInput !== undefined && typeof step.requiresInput !== 'boolean') {
        errors.push(`steps[${i}].requiresInput must be a boolean if present.`);
      }
    }
  }

  // needsMoreInfo — optional boolean
  if (parsed.needsMoreInfo !== undefined && typeof parsed.needsMoreInfo !== 'boolean') {
    errors.push('"needsMoreInfo" must be a boolean if present.');
  }

  // question — must be string if needsMoreInfo is true
  if (parsed.needsMoreInfo === true) {
    if (typeof parsed.question !== 'string' || parsed.question.trim().length === 0) {
      errors.push('"question" must be a non-empty string when needsMoreInfo is true.');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Schema validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  // Normalize: fill defaults
  return {
    intent: parsed.intent.trim(),
    steps: (parsed.steps || []).map(s => ({
      command: s.command.trim(),
      description: (s.description || s.command).trim(),
      requiresInput: s.requiresInput === true,
    })),
    needsMoreInfo: parsed.needsMoreInfo === true,
    question: parsed.question || null,
    notes: typeof parsed.notes === 'string' ? parsed.notes.trim() : null,
  };
}

// ─── System Prompt with Few-Shot Examples ──────────────────

function buildSystemPrompt() {
  const systemInfo = getSystemInfo();
  const contextSummary = buildContextSummary();

  const osExamples = systemInfo.os === 'windows'
    ? `
## Few-Shot Examples (Windows PowerShell)

User: "check disk space"
Response:
{"intent":"Check disk space usage","steps":[{"command":"Get-PSDrive -PSProvider FileSystem | Format-Table Name, Used, Free, @{Name='Size(GB)';Expression={[math]::Round($_.Used/1GB + $_.Free/1GB, 2)}} -AutoSize","description":"Show disk space for all drives","requiresInput":false}],"needsMoreInfo":false,"question":null,"notes":null}

User: "list all running processes"
Response:
{"intent":"List running processes","steps":[{"command":"Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 Name, Id, CPU, WorkingSet","description":"List top 20 processes by CPU usage","requiresInput":false}],"needsMoreInfo":false,"question":null,"notes":null}

User: "push changes"
Response:
{"intent":"Stage, commit, and push all changes to remote","steps":[{"command":"git add .","description":"Stage all changes","requiresInput":false},{"command":"git commit -m \\"<message>\\"","description":"Commit with a message","requiresInput":true},{"command":"git pull --rebase","description":"Pull and rebase before pushing","requiresInput":false},{"command":"git push","description":"Push to remote","requiresInput":false}],"needsMoreInfo":false,"question":null,"notes":"Make sure you have a remote configured."}`
    : `
## Few-Shot Examples (Unix/macOS)

User: "check disk space"
Response:
{"intent":"Check disk space usage","steps":[{"command":"df -h","description":"Show disk space usage for all mounted filesystems","requiresInput":false}],"needsMoreInfo":false,"question":null,"notes":null}

User: "list all running processes"
Response:
{"intent":"List running processes","steps":[{"command":"ps aux --sort=-%cpu | head -20","description":"List top 20 processes by CPU usage","requiresInput":false}],"needsMoreInfo":false,"question":null,"notes":null}

User: "push changes"
Response:
{"intent":"Stage, commit, and push all changes to remote","steps":[{"command":"git add .","description":"Stage all changes","requiresInput":false},{"command":"git commit -m \\"<message>\\"","description":"Commit with a message","requiresInput":true},{"command":"git pull --rebase","description":"Pull and rebase before pushing","requiresInput":false},{"command":"git push","description":"Push to remote","requiresInput":false}],"needsMoreInfo":false,"question":null,"notes":"Make sure you have a remote configured."}`;

  return `You are an AI assistant embedded in a CLI terminal. Your job is to translate natural language instructions into structured execution plans.

## Environment
- Operating System: ${systemInfo.os} (${systemInfo.platform}, ${systemInfo.arch})
- Shell: ${systemInfo.shell}
- Current directory: ${systemInfo.cwd}
- Username: ${systemInfo.user}
- Node.js version: ${systemInfo.nodeVersion}

## Project Context
${contextSummary}

## Rules
1. Generate commands that are correct for the detected OS and shell.
2. For Windows PowerShell, use PowerShell-native syntax (e.g., Get-PSDrive, Get-Process, Get-ChildItem, Test-Path, etc.) OR well-known cross-platform tools (git, npm, node, python, etc.).
3. For bash/zsh, use standard Unix commands.
4. Always prefer safe, non-destructive commands when possible.
5. If the user asks something ambiguous, still provide your best guess but note the ambiguity in "notes".
6. If the user is asking to do something in the context of a project (e.g., "run backend"), use the detected project scripts/tools.
7. Never generate commands that expose secrets, API keys, or passwords in output.
8. When the user uses pronouns like "it", "that", "them", or says "again", "undo", "last" — refer to conversation history to resolve the reference.

## Output Format
You MUST respond with ONLY valid JSON (no markdown code fences, no explanation outside the JSON). Use this exact schema:

{
  "intent": "short description of what the user wants to do",
  "steps": [
    {
      "command": "the exact shell command to run",
      "description": "human-readable description of this step",
      "requiresInput": false
    }
  ],
  "needsMoreInfo": false,
  "question": null,
  "notes": "any additional notes or warnings"
}

Field rules:
- "intent" — REQUIRED, non-empty string.
- "steps" — REQUIRED, array of step objects. Each step MUST have "command" (non-empty string), "description" (string), and "requiresInput" (boolean).
- "needsMoreInfo" — boolean, default false. If true, "question" must be a non-empty string.
- "question" — string or null.
- "notes" — string or null.

If you need more information, set "needsMoreInfo" to true, "question" to your question, and "steps" to [].

If a step requires user input (like a commit message), set "requiresInput" to true and include a placeholder like "<message>" in the command.
${osExamples}`;
}

// ─── JSON Extraction Helpers ───────────────────────────────

/**
 * Attempt to extract valid JSON from an AI response text.
 * Handles: raw JSON, ```json fences, partial text before/after JSON.
 */
function extractJSON(text) {
  // 1. Try raw parse
  try {
    return JSON.parse(text);
  } catch { /* continue */ }

  // 2. Try extracting from markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch { /* continue */ }
  }

  // 3. Try to find the first { ... } block (greedy)
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch { /* continue */ }
  }

  return null;
}

// ─── Main Intent Parser ───────────────────────────────────

/**
 * Parse a natural language instruction into a structured intent.
 * Uses the AI router (OpenRouter free → Gemini fallback).
 *
 * @param {string} instruction - The user's natural language input
 * @param {Array<{role: string, content: string}>} [conversationHistory] - Optional chat history for context
 * @returns {Promise<object|null>} - Parsed and validated intent object, or null on failure
 */
export async function parseIntent(instruction, conversationHistory = []) {
  const systemPrompt = buildSystemPrompt();

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const spinner = ora({
      text: attempt === 0
        ? chalk.cyan('⚡ Planning...')
        : chalk.cyan(`⚡ Replanning (${attempt}/${MAX_RETRIES})...`),
      spinner: 'dots',
    }).start();

    try {
      // Build messages array in OpenAI-compatible format (the router handles conversion)
      const messages = [];

      // Add conversation history if present (for chat mode)
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: msg.content,
        });
      }

      // Add current instruction
      messages.push({
        role: 'user',
        content: instruction,
      });

      // Call through the router — executing natively and silently fetching AI fallbacks
      const result = await callAI(systemPrompt, messages, {
        temperature: 0.1,
        maxTokens: 2048,
        jsonMode: true,
        silent: true,  // Strictly block routing logs to keep UX polished
      });

      spinner.stop();

      if (!result.success) {
        throw new Error(result.error || 'All AI models failed');
      }

      const text = result.content;

      if (!text) {
        throw new Error('AI returned an empty response.');
      }

      // Extract JSON robustly
      const parsed = extractJSON(text);
      if (!parsed) {
        throw new Error(`Could not extract JSON from AI response: ${text.substring(0, 200)}`);
      }

      // Validate and normalize
      const validated = validateIntentSchema(parsed);
      return validated;

    } catch (error) {
      spinner.stop();
      lastError = error;

      // Don't retry on errors that won't self-resolve
      const msg = error.message || '';
      const isAllModelsFailed = msg.includes('All AI models failed') || msg.includes('All configured models and fallbacks failed') || msg.includes('NO_API_KEY');
      const isAuthError = msg.includes('Auth error') || msg.includes('API_KEY_INVALID');
      const isRateLimited = msg.includes('429') || msg.includes('rate limit') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED');

      if (isAllModelsFailed || isAuthError || isRateLimited) {
        break;
      }

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    }
  }

  // All retries exhausted — display appropriate message
  const msg = lastError?.message || 'Unknown error';

  if (lastError instanceof SyntaxError || msg.includes('Schema validation') || msg.includes('extract JSON')) {
    console.error(chalk.red('\n✗ Failed to parse AI response after retries.'));
    console.error(chalk.yellow(`  ${msg}\n`));
  } else if (msg.includes('NO_API_KEY')) {
    console.error(chalk.red('\n✗ No API keys configured.'));
    console.error(chalk.yellow('  Set OPENROUTER_API_KEY and/or GEMINI_API_KEY in your config or .env file.\n'));
  } else if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
    console.error(chalk.red('\n✗ All AI providers are rate-limited. Please wait a moment and try again.'));
    console.error(chalk.yellow('  Tip: Free-tier models have strict rate limits. Space your requests.\n'));
  } else if (msg.includes('All AI models failed') || msg.includes('fallbacks failed')) {
    console.error(chalk.red('\n✗ All AI models failed. Check your internet connection and API keys.'));
    console.error(chalk.yellow(`  ${msg}\n`));
  } else {
    console.error(chalk.red(`\n✗ AI Error: ${msg.substring(0, 300)}\n`));
  }

  return null;
}

// ─── Error Explainer ──────────────────────────────────────

/**
 * Ask the AI to explain an error and suggest a fix.
 * Uses the router for automatic fallback.
 *
 * @param {string} command - The command that failed
 * @param {string} stderr - The error output
 * @param {string} stdout - The standard output (if any)
 * @returns {Promise<string>} - Human-readable explanation and suggestion
 */
export async function explainError(command, stderr, stdout = '') {
  const systemInfo = getSystemInfo();

  const spinner = ora({
    text: chalk.cyan('Analyzing error...'),
    spinner: 'dots',
  }).start();

  try {
    // Cap stderr/stdout to avoid token overflow
    const truncatedStderr = (stderr || '(empty)').substring(0, 1000);
    const truncatedStdout = (stdout || '(empty)').substring(0, 500);

    const systemPrompt = 'You are a helpful terminal assistant that explains errors clearly and suggests fixes.';

    const userMessage = `A shell command failed. Help me understand and fix it.

Environment: ${systemInfo.os}, ${systemInfo.shell}
Command: ${command}
Stderr: ${truncatedStderr}
Stdout: ${truncatedStdout}

Provide:
1. A plain English explanation of what went wrong
2. A suggested fix (either a corrected command or steps to resolve)

Keep it concise and actionable. Reply in plain text, not JSON.`;

    const result = await callAISimple(systemPrompt, userMessage, {
      temperature: 0.3,
      maxTokens: 1024,
      jsonMode: false,
      silent: true,  // Don't show routing logs for error analysis
    });

    spinner.stop();

    if (result.success) {
      return result.content;
    }

    return `Could not analyze error: ${result.error}`;
  } catch (error) {
    spinner.stop();
    return `Could not analyze error: ${error.message}`;
  }
}
