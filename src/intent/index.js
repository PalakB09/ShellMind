// Intent Engine — parses natural language into structured intent via AI router.
import chalk from 'chalk';
import ora from 'ora';
import { callAI, callAISimple } from '../ai/router.js';
import { getSystemInfo } from '../os-adapter/index.js';
import { buildContextSummary } from '../context/index.js';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Validates the raw AI response against the production-ready rules.
 * Reject if: empty, multiple lines, or contains conversational filler.
 */
function validateRawResponse(text) {
  if (!text || text.trim().length === 0) {
    throw new Error('AI returned an empty response.');
  }

  const lines = text.trim().split('\n');
  if (lines.length > 1) {
    throw new Error('AI returned multiple lines. Expected a single shell command.');
  }

  const lower = text.toLowerCase();
  const forbidden = [
    'this command', 'here is', 'you can', 'try running', 
    '```', '`', 'here\'s', 'sure', 'ok', 'okay', 'the command is'
  ];
  for (const word of forbidden) {
    if (lower.includes(word)) {
      throw new Error(`AI response contains forbidden conversational text or markdown: "${word}"`);
    }
  }

  return text.trim();
}

/**
 * Wraps a single command into the structured intent schema used by the pipeline.
 */
function wrapCommandToIntent(command, instruction) {
  return {
    intent: instruction,
    steps: [
      {
        command: command,
        description: command,
        requiresInput: command.includes('<') && command.includes('>'),
      }
    ],
    needsMoreInfo: false,
    question: null,
    notes: null,
  };
}

/**
 * Builds the system prompt for single-command generation.
 */
function buildSystemPrompt() {
  const systemInfo = getSystemInfo();
  const contextSummary = buildContextSummary();

  return `You are a terminal command generator.

## Environment
- OS: ${systemInfo.os}
- Shell: ${systemInfo.shell}
- CWD: ${systemInfo.cwd}

## Project Context
${contextSummary}

## Rules
1. Output ONLY the command.
2. NO explanation, NO markdown, NO extra text.
3. Use a single line.
4. If a step requires user input, use <placeholder> (e.g. git commit -m "<message>").
5. Be accurate and relevant to the OS and shell.`;
}

/**
 * Parse a natural language instruction into a structured intent.
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
      const messages = conversationHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: msg.content,
      }));

      messages.push({ role: 'user', content: instruction });

      const result = await callAI(systemPrompt, messages, {
        temperature: 0.1,
        silent: true,
      });

      spinner.stop();

      if (!result.success) {
        throw new Error(result.error || 'All AI models failed');
      }

      // Validate and Clean
      const cleanCommand = validateRawResponse(result.content);
      
      // Wrap into existing pipeline format
      return wrapCommandToIntent(cleanCommand, instruction);

    } catch (error) {
      spinner.stop();
      lastError = error;

      const msg = error.message || '';
      const isFatal = msg.includes('All AI models failed') || msg.includes('No AI provider reachable');

      if (isFatal) break;

      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
    }
  }

  // Error reporting
  const msg = lastError?.message || 'Unknown error';
  if (msg.includes('No AI provider reachable')) {
    console.error(chalk.yellow('\n⚠ No AI provider reachable. Ensure Ollama is running or Gemini API key is set.\n'));
  } else {
    console.error(chalk.red(`\n✗ AI Error: ${msg}\n`));
  }

  return null;
}

/**
 * Ask the AI to explain an error.
 */
export async function explainError(command, stderr, stdout = '') {
  const systemInfo = getSystemInfo();

  const spinner = ora({
    text: chalk.cyan('Analyzing error...'),
    spinner: 'dots',
  }).start();

  try {
    const systemPrompt = 'You are a helpful terminal assistant. Explain errors clearly and suggest fixes in plain text (1-2 sentences).';
    const userMessage = `Command failed: ${command}\nStderr: ${stderr}\nStdout: ${stdout}\nOS: ${systemInfo.os}`;

    const result = await callAISimple(systemPrompt, userMessage, {
      temperature: 0.3,
      silent: true,
    });

    spinner.stop();
    return result.success ? result.content : `Could not analyze error: ${result.error}`;
  } catch (error) {
    spinner.stop();
    return `Could not analyze error: ${error.message}`;
  }
}
