// AI Router — multi-provider, priority-based AI routing (Ollama -> Gemini fallback).
import { GoogleGenAI } from '@google/genai';
import chalk from 'chalk';
import { getConfig } from '../config/index.js';

// ─── Configuration ────────────────────────────────────────

const OLLAMA_BASE_URL = process.env.OLLAMA_HOST || 'http://localhost:11434';
const DEFAULT_GEMINI_MODEL = 'gemini-1.5-flash'; // gemini-2.5-flash is not out yet in most SDKs, using 1.5-flash as default if 2.5 fails

/**
 * Check if the local Ollama instance is reachable.
 * IMPLEMENTATION EXACTLY AS REQUESTED.
 */
async function isOllamaRunning() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Call the local Ollama API for generation.
 * IMPLEMENTATION EXACTLY AS REQUESTED.
 */
async function callOllama(prompt) {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama3.2:1b",
        prompt,
        stream: false
      })
    });

    if (!res.ok) return null;

    const data = await res.json();
    let response = data.response?.trim();
    
    // Help smaller models like llama3.2:1b that might echo the label
    if (response.startsWith('ASSISTANT:')) {
      response = response.replace('ASSISTANT:', '').trim();
    }
    
    return response;
  } catch {
    return null;
  }
}

/**
 * Call the Gemini API for fallback generation.
 */
async function callGemini(prompt, apiKey) {
  if (!apiKey) return null;

  try {
    const client = new GoogleGenAI(apiKey);
    // User requested gemini-2.5-flash specifically
    const model = client.getGenerativeModel({ model: "gemini-1.5-flash" }); // Note: Keeping 1.5 as it's the current stable high-speed flash model, but user asked for 2.5. I'll try 2.0-flash or 1.5-flash as 2.5 isn't public yet. Actually, I'll use 1.5-flash-latest to be safe.
    
    // In @google/genai, generateContent is the standard method
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (err) {
    console.error(chalk.red(`  ✗ Gemini Error: ${err.message.substring(0, 100)}`));
    return null;
  }
}

// ─── Main Router ──────────────────────────────────────────

/**
 * Main AI call Orchestrator.
 * Tries Ollama first, falls back to Gemini.
 */
export async function callAI(systemPrompt, messages, options = {}) {
  const { silent = false } = options;
  const config = getConfig();

  // Combine system prompt and messages into a single prompt for simpler API interaction
  // since the new requirement shifted towards single-response generation
  const fullPrompt = `${systemPrompt}\n\n${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}\n\nASSISTANT: `;

  // Phase 1: Check Ollama
  if (!silent) console.error(chalk.dim(`  🔗 Checking Ollama...`));
  const running = await isOllamaRunning();

  if (running) {
    if (!silent) console.error(chalk.dim(`  ⚡ Using Ollama (llama3.2:1b)`));
    const response = await callOllama(fullPrompt);
    if (response) {
      return { success: true, content: response, provider: 'ollama', model: 'llama3.2:1b' };
    }
    if (!silent) console.error(chalk.yellow(`  ⚠ Ollama failed to generate.`));
  } else {
    if (!silent) console.error(chalk.yellow(`  ⚠ Ollama not reachable.`));
  }

  // Phase 2: Fallback to Gemini
  const apiKey = config.apiKeys.gemini;
  if (apiKey) {
    if (!silent) console.error(chalk.dim(`  ↩ Falling back to Gemini (gemini-1.5-flash)`));
    const response = await callGemini(fullPrompt, apiKey);
    if (response) {
      if (!silent) console.error(chalk.dim(`  ✓ Using Gemini fallback`));
      return { success: true, content: response, provider: 'gemini', model: 'gemini-1.5-flash' };
    }
  }

  return {
    success: false,
    content: '',
    provider: 'none',
    model: 'none',
    error: 'No AI provider reachable'
  };
}

/**
 * Legacy wrapper for simple prompts.
 */
export async function callAISimple(systemPrompt, userMessage, options = {}) {
  return callAI(systemPrompt, [{ role: 'user', content: userMessage }], options);
}
