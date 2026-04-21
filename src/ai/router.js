// AI Router — hybrid multi-provider routing (Ollama → Gemini fallback).
// FIXED: 127.0.0.1 instead of localhost (Windows IPv6 compat), null model guard, Gemini 2.0.
import { GoogleGenAI } from '@google/genai';
import chalk from 'chalk';
import { getConfig } from '../config/index.js';
import { logAI, logModel } from '../cli/format.js';

const OLLAMA_TIMEOUT_MS = 120_000;
const GEMINI_TIMEOUT_MS = 20_000;

// ─── Utilities ────────────────────────────────────────────

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

function getOllamaBaseUrls() {
  const configured = process.env.OLLAMA_HOST?.trim();
  const candidates = [
    configured,
    'http://127.0.0.1:11434',
    'http://localhost:11434',
  ].filter(Boolean);

  return [...new Set(candidates)];
}

// ─── Ollama (Local) ───────────────────────────────────────

/**
 * Check if the local Ollama daemon is reachable.
 */
export async function isOllamaRunning() {
  for (const baseUrl of getOllamaBaseUrls()) {
    try {
      const res = await withTimeout(
        fetch(`${baseUrl}/api/tags`),
        3000,
        'Ollama health check'
      );
      if (res.ok) return baseUrl;
    } catch {
      // try next candidate
    }
  }

  return null;
}

async function getOllamaTags(baseUrl) {
  const res = await withTimeout(fetch(`${baseUrl}/api/tags`), 3000, 'Ollama tags');
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || []).map((model) => model.name);
}

/**
 * Get the list of locally pulled Ollama models.
 */
export async function getOllamaModels() {
  for (const baseUrl of getOllamaBaseUrls()) {
    try {
      const models = await getOllamaTags(baseUrl);
      if (models.length > 0) return models;
    } catch {
      // try next candidate
    }
  }

  return [];
}

export async function resolveOllamaRuntime(preferredModel = null) {
  for (const baseUrl of getOllamaBaseUrls()) {
    try {
      const models = await getOllamaTags(baseUrl);
      if (preferredModel) {
        if (models.includes(preferredModel)) {
          return { baseUrl, model: preferredModel, models };
        }
        continue;
      }

      if (models.length > 0) {
        return { baseUrl, model: models[0], models };
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

/**
 * Call Ollama using the /api/chat endpoint with proper system/user message separation.
 * This replaces the old /api/generate endpoint which lost system prompt isolation.
 */
async function callOllama(systemPrompt, messages, model, baseUrl) {
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ],
    stream: false,
    options: {
      temperature: 0.1,
      top_p: 0.9,
      num_predict: 512,
    },
  });

  try {
    const res = await withTimeout(
      fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      OLLAMA_TIMEOUT_MS,
      'Ollama generate'
    );

    if (!res.ok) return null;
    const data = await res.json();
    return data.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

// ─── Gemini (Cloud) ───────────────────────────────────────

/**
 * Call Google Gemini using the correct @google/genai v1.0.0 SDK API.
 * FIXED: Previously used .getGenerativeModel() which does not exist in v1.0.0.
 */
async function callGemini(systemPrompt, messages, model, apiKey) {
  if (!apiKey) return null;

  try {
    const client = new GoogleGenAI({ apiKey });

    // Map conversation history — Gemini uses 'model' role instead of 'assistant'
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const result = await withTimeout(
      client.models.generateContent({
        model,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.1,
          topP: 0.9,
          maxOutputTokens: 512,
        },
        contents,
      }),
      GEMINI_TIMEOUT_MS,
      'Gemini generate'
    );

    // In @google/genai v1.0.0, result.text is a getter (not a function call)
    return result.text?.trim() || null;
  } catch (err) {
    const msg = err.message || '';
    // Surface key errors clearly, swallow quota/network errors for silent fallback
    if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED')) {
      process.stderr.write(chalk.red(`  ✗ Gemini: Invalid API key. Run \`ai init\` to reconfigure.\n`));
    } else if (!msg.includes('timed out')) {
      process.stderr.write(chalk.red(`  ✗ Gemini: ${msg.substring(0, 100)}\n`));
    }
    return null;
  }
}

// ─── Main Router ──────────────────────────────────────────

/**
 * Primary AI call orchestrator.
 *
 * Routing order:
 *   1. Ollama (local, private, zero-cost)
 *   2. Gemini (cloud fallback)
 *
 * Models are read from config — no hardcoding.
 *
 * @param {string} systemPrompt
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} options
 * @returns {Promise<{success: boolean, content: string, provider: string, model: string, error?: string}>}
 */
export async function callAI(systemPrompt, messages, options = {}) {
  const { silent = false, validateResponse } = options;
  const config = getConfig();

  const configuredLocalModel = config.models?.local || null;
  const cloudModel = config.models?.cloud || 'gemini-2.0-flash';
  const ollamaRuntime = await resolveOllamaRuntime(configuredLocalModel);

  // Phase 1: Local Ollama — resolve a real reachable host + usable model, then call it directly.
  if (ollamaRuntime) {
    if (!silent) logModel(`Using local model (${ollamaRuntime.model})`);
    const response = await callOllama(systemPrompt, messages, ollamaRuntime.model, ollamaRuntime.baseUrl);
    if (response) {
      try {
        if (validateResponse) validateResponse(response);
        return { success: true, content: response, provider: 'ollama', model: ollamaRuntime.model };
      } catch (error) {
        if (!silent) logAI(`Local model returned invalid output: ${error.message}. Falling back to cloud.`);
      }
    }
    if (!silent) logAI('Local model returned no usable output. Falling back to cloud.');
  } else {
    if (configuredLocalModel) {
      if (!silent) logAI(`Configured local model (${configuredLocalModel}) was not found on reachable Ollama hosts. Trying cloud.`);
    } else {
      if (!silent) logAI('No usable local Ollama model was discovered. Trying cloud directly.');
    }
  }

  // Phase 2: Gemini cloud fallback
  const apiKey = config.apiKeys?.gemini;
  if (apiKey) {
    if (!silent) logModel(`Using cloud model (${cloudModel})`);
    const response = await callGemini(systemPrompt, messages, cloudModel, apiKey);
    if (response) {
      try {
        if (validateResponse) validateResponse(response);
        return { success: true, content: response, provider: 'gemini', model: cloudModel };
      } catch (error) {
        if (!silent) logAI(`Cloud model returned invalid output: ${error.message}`);
      }
    }
  }

  // Determine the accurate error message:
  // If Ollama responded but validation failed, that's NOT 'unreachable'
  const ollamaWasReachable = !!ollamaRuntime;
  const geminiWasAttempted = !!apiKey;

  let error;
  if (!ollamaWasReachable && !geminiWasAttempted) {
    error = 'No AI provider reachable. Ensure Ollama is running or run `ai init` to configure Gemini.';
  } else {
    error = 'AI provider returned unusable output. The model may need a clearer prompt or a retry.';
  }

  return {
    success: false,
    content: '',
    provider: 'none',
    model: 'none',
    error,
  };
}

/**
 * Convenience wrapper for single-turn prompts.
 */
export async function callAISimple(systemPrompt, userMessage, options = {}) {
  return callAI(systemPrompt, [{ role: 'user', content: userMessage }], options);
}
