// AI Router — multi-provider, priority-based AI routing with OpenRouter free fallback.
import { GoogleGenAI } from '@google/genai';
import chalk from 'chalk';
import { getConfig, hasAnyApiKey } from '../config/index.js';

// ─── Configuration ────────────────────────────────────────

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// Fallback OpenRouter free models IN ORDER (verified available).
const FREE_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'google/gemma-3-12b-it:free',
  'google/gemma-3-4b-it:free',
  'meta-llama/llama-3.2-3b-instruct:free',
];

const REQUEST_TIMEOUT_MS = 30_000;

// Default Gemini fallback models if user configures gemini but specifies no models
let GEMINI_FALLBACKS = ['gemini-1.5-pro']; // Legacy placeholder array, gets overwritten

/**
 * Dynamically figures out the best Gemini API models by listing models on the v1beta endpoint.
 * Cached to config.json as an array so it's a one-time operation.
 */
async function resolveGeminiModel(apiKey) {
  const config = getConfig();
  if (config.geminiFallbackCache && config.geminiFallbackCache.length > 0) {
    GEMINI_FALLBACKS = config.geminiFallbackCache;
    return;
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (!res.ok) return;

    const data = await res.json();
    const available = (data.models || [])
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name.replace('models/', ''));

    // Preference tiers (best -> acceptable fallback)
    const PREFERENCES = [
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.0-pro',
      'gemini-2.0-flash',
      'gemini-1.5-pro-latest',
      'gemini-1.5-flash-latest',
      'gemini-1.5-pro',
      'gemini-1.5-flash'
    ];

    const detected = [];
    for (const pref of PREFERENCES) {
      // Find exactly matching OR starts-with to catch versions
      const match = available.find(m => m === pref || m.startsWith(pref));
      if (match && !detected.includes(match)) {
        detected.push(match);
      }
    }

    if (detected.length > 0) {
      GEMINI_FALLBACKS = detected;
      const { saveConfig } = await import('../config/index.js');
      saveConfig({ geminiFallbackCache: detected });
    }
  } catch (err) {
    // Silently ignore, fallback to primitive GEMINI_FALLBACKS
  }
}

// Track cooldowns per model to avoid hammering rate-limited endpoints
const modelCooldowns = new Map();
const COOLDOWN_MS = 60_000;

// ─── Helpers ──────────────────────────────────────────────

function assertFreeModel(model) {
  if (!model.endsWith(':free')) {
    throw new Error(`SAFETY: Model "${model}" is NOT a free OpenRouter model. Only :free suffix models are allowed in fallback. Blocking to prevent charges.`);
  }
}

function isOnCooldown(model) {
  const until = modelCooldowns.get(model);
  if (!until) return false;
  if (Date.now() >= until) {
    modelCooldowns.delete(model);
    return false;
  }
  return true;
}

function setCooldown(model, durationMs = COOLDOWN_MS) {
  modelCooldowns.set(model, Date.now() + durationMs);
}

function modelLabel(model) {
  if (model.includes('/')) return model.split('/').pop().replace(':free', '').replace('-instruct', '').replace('-it', '');
  return model;
}

// ─── Providers ────────────────────────────────────────────

async function callOpenRouter(model, systemPrompt, messages, options = {}, apiKey, enforceFree = false) {
  if (enforceFree) assertFreeModel(model);

  const { temperature = 0.1, maxTokens = 2048, jsonMode = false } = options;

  if (!apiKey) {
    return { success: false, content: '', provider: 'openrouter', model, error: 'OPENROUTER_API_KEY not set' };
  }

  if (isOnCooldown(model)) {
    return { success: false, content: '', provider: 'openrouter', model, error: `Model on cooldown (429 backoff)` };
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    temperature,
    max_tokens: maxTokens,
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/ai-cli-assistant',
        'X-Title': 'AI CLI Assistant',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const status = response.status;
      let errorBody = '';
      try { errorBody = await response.text(); } catch { /* ignore */ }

      if (status === 429) {
        setCooldown(model);
        return { success: false, content: '', provider: 'openrouter', model, error: `429 rate limit` };
      }
      if (status === 401 || status === 403) {
        return { success: false, content: '', provider: 'openrouter', model, error: `Auth error (${status})` };
      }

      return { success: false, content: '', provider: 'openrouter', model, error: `HTTP ${status}: ${errorBody.substring(0, 200)}` };
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (!content) return { success: false, content: '', provider: 'openrouter', model, error: 'Empty response content' };

    return { success: true, content, provider: 'openrouter', model };

  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      return { success: false, content: '', provider: 'openrouter', model, error: `Timeout after ${REQUEST_TIMEOUT_MS / 1000}s` };
    }
    return { success: false, content: '', provider: 'openrouter', model, error: error.message };
  }
}

async function callGemini(model, systemPrompt, messages, options = {}, apiKey) {
  const { temperature = 0.1, maxTokens = 2048, jsonMode = false } = options;

  if (!apiKey) {
    return { success: false, content: '', provider: 'gemini', model, error: 'GEMINI_API_KEY not set' };
  }

  if (isOnCooldown(model)) {
    return { success: false, content: '', provider: 'gemini', model, error: `Model on cooldown (429 backoff)` };
  }

  try {
    const client = new GoogleGenAI({ apiKey });
    const geminiMessages = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    const genConfig = {
      systemInstruction: systemPrompt,
      temperature,
      maxOutputTokens: maxTokens,
    };

    if (jsonMode) {
      genConfig.responseMimeType = 'application/json';
    }

    const response = await client.models.generateContent({
      model: model,
      contents: geminiMessages,
      config: genConfig,
    });

    const content = (response.text || '').trim();

    if (!content) return { success: false, content: '', provider: 'gemini', model, error: 'Empty response' };

    return { success: true, content, provider: 'gemini', model };

  } catch (error) {
    const status = error.status;
    if (status === 429 || error.message?.includes('429')) {
      setCooldown(model);
      return { success: false, content: '', provider: 'gemini', model, error: `429 rate limit` };
    }
    const msg = error.message || 'Unknown Gemini error';
    return { success: false, content: '', provider: 'gemini', model, error: `Gemini error (${status || '?'}): ${msg.substring(0, 200)}` };
  }
}

// ─── Main Router ──────────────────────────────────────────

/**
 * Route an AI request. Tries user-configured models first, then falls back to OpenRouter free models.
 */
export async function callAI(systemPrompt, messages, options = {}) {
  const { silent = false } = options;

  if (!hasAnyApiKey()) {
    // If we've made it here despite No-Key guards, return a strict rejection
    return { success: false, content: '', provider: 'none', model: 'none', error: 'NO_API_KEY' };
  }

  const config = getConfig();

  // ─── Phase 1: Try user-configured models ─────────────────

  if (config.provider && config.models.length > 0) {
    for (const model of config.models) {
      if (isOnCooldown(model)) {
        if (!silent) console.error(chalk.dim(`  ⏳ Skipping ${modelLabel(model)} (cooldown)`));
        continue;
      }

      if (!silent) console.error(chalk.dim(`  🔗 Trying ${config.provider}: ${modelLabel(model)}`));

      let result;
      if (config.provider === 'gemini') {
        result = await callGemini(model, systemPrompt, messages, options, config.apiKeys.gemini);
      } else if (config.provider === 'openrouter') {
        result = await callOpenRouter(model, systemPrompt, messages, options, config.apiKeys.openrouter, false);
      } else {
        if (!silent) console.error(chalk.dim(`  ⚠ Unknown provider: ${config.provider}`));
        continue;
      }

      if (result && result.success) {
        if (!silent) console.error(chalk.dim(`  ✓ Using: ${modelLabel(model)} (${config.provider})`));
        return result;
      }

      if (!silent) console.error(chalk.dim(`  ✗ ${modelLabel(model)}: ${result.error}`));
    }
  } else if (config.provider === 'gemini' && config.apiKeys.gemini) {
    // Edge case: Gemini provider but no models listed
    await resolveGeminiModel(config.apiKeys.gemini);
    const topModel = GEMINI_FALLBACKS[0];
    
    if (isOnCooldown(topModel)) {
      if (!silent) console.error(chalk.dim(`  ⏳ Skipping default Gemini: ${topModel} (cooldown)`));
    } else {
      if (!silent) console.error(chalk.dim(`  🔗 Trying default Gemini: ${topModel}`));
      const result = await callGemini(topModel, systemPrompt, messages, options, config.apiKeys.gemini);
      if (result.success) {
         if (!silent) console.error(chalk.dim(`  ✓ Using: ${topModel} (gemini)`));
         return result;
      }
      if (!silent) console.error(chalk.dim(`  ✗ Gemini: ${result.error}`));
    }
  }

  // ─── Phase 2: Fallback to Gemini ─────────────────────────

  const hasGeminiKey = !!config.apiKeys.gemini;
  if (hasGeminiKey) {
    await resolveGeminiModel(config.apiKeys.gemini);
    
    if (!silent) console.error(chalk.dim(`  ↩ Falling back to Gemini (Native Models)`));
    
    for (const dModel of GEMINI_FALLBACKS) {
      // Check if we already tried the exact default gemini model in Phase 1 to avoid double-calling
      const alreadyTried = config.models && config.models.includes(dModel);
      if (alreadyTried) continue;
      
      if (isOnCooldown(dModel)) {
        if (!silent) console.error(chalk.dim(`  ⏳ Skipping ${dModel} (cooldown)`));
        continue;
      }

      if (!silent) console.error(chalk.dim(`  🔗 Trying Gemini fallback: ${dModel}`));
      
      const result = await callGemini(dModel, systemPrompt, messages, options, config.apiKeys.gemini);
      
      if (result.success) {
        if (!silent) console.error(chalk.dim(`  ✓ Using: ${dModel} (gemini)`));
        return result;
      }
      
      if (!silent) console.error(chalk.dim(`  ✗ Gemini: ${result.error}`));
    }
  }

  // ─── Phase 3: Fallback to OpenRouter Free Models ─────────

  const hasOrKey = !!config.apiKeys.openrouter;
  if (hasOrKey) {
    if (!silent) console.error(chalk.dim(`  ↩ Falling back to OpenRouter (free models)`));
    
    for (const model of FREE_MODELS) {
      // Check if already tried in Phase 1
      const alreadyTried = config.models && config.models.includes(model);
      if (alreadyTried) continue;

      if (isOnCooldown(model)) {
        if (!silent) console.error(chalk.dim(`  ⏳ Skipping ${modelLabel(model)} (cooldown)`));
        continue;
      }

      if (!silent) console.error(chalk.dim(`  🔗 Trying OpenRouter fallback: ${modelLabel(model)}`));

      const result = await callOpenRouter(model, systemPrompt, messages, options, config.apiKeys.openrouter, true);

      if (result.success) {
        if (!silent) console.error(chalk.dim(`  ✓ Using: ${modelLabel(model)} (openrouter)`));
        return result;
      }

      if (!silent) console.error(chalk.dim(`  ✗ ${modelLabel(model)}: ${result.error}`));
    }
  }

  // ─── Phase 4: No models succeeded ────────────────────────

  return {
    success: false,
    content: '',
    provider: 'none',
    model: 'none',
    error: 'All configured models and fallbacks failed',
  };
}

export async function callAISimple(systemPrompt, userMessage, options = {}) {
  return callAI(systemPrompt, [{ role: 'user', content: userMessage }], options);
}
