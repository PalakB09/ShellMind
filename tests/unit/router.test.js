import test from 'node:test';
import assert from 'node:assert/strict';
import { getOllamaModels, resolveOllamaRuntime } from '../../src/ai/router.js';

test('resolveOllamaRuntime picks configured model from reachable host', async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => ({
    ok: true,
    async json() {
      return { models: [{ name: 'llama3.2:1b' }, { name: 'llama3.2:3b' }] };
    },
  });

  try {
    const runtime = await resolveOllamaRuntime('llama3.2:1b');
    assert.equal(runtime.model, 'llama3.2:1b');
    assert.match(runtime.baseUrl, /^http:\/\/(127\.0\.0\.1|localhost):11434$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('resolveOllamaRuntime falls back to first discovered model when none configured', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { models: [{ name: 'qwen2.5-coder:7b' }] };
    },
  });

  try {
    const runtime = await resolveOllamaRuntime(null);
    assert.equal(runtime.model, 'qwen2.5-coder:7b');
  } finally {
    global.fetch = originalFetch;
  }
});

test('getOllamaModels returns discovered models from reachable host', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    async json() {
      return { models: [{ name: 'llama3.2:1b' }, { name: 'mistral:7b' }] };
    },
  });

  try {
    const models = await getOllamaModels();
    assert.deepEqual(models, ['llama3.2:1b', 'mistral:7b']);
  } finally {
    global.fetch = originalFetch;
  }
});
