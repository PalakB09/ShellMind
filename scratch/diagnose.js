// Diagnose exactly where the Ollama connection fails
import { getConfig } from '../src/config/index.js';
import { isOllamaRunning, getOllamaModels, resolveOllamaRuntime } from '../src/ai/router.js';

console.log('=== Step 1: Config ===');
const config = getConfig();
console.log(JSON.stringify(config, null, 2));

console.log('\n=== Step 2: Raw fetch to 127.0.0.1:11434 ===');
try {
  const res = await fetch('http://127.0.0.1:11434/api/tags');
  console.log('Status:', res.status, res.statusText);
  const data = await res.json();
  console.log('Models:', JSON.stringify(data.models?.map(m => m.name)));
} catch (err) {
  console.log('FETCH FAILED:', err.message);
  console.log('Error type:', err.constructor.name);
  console.log('Error code:', err.cause?.code || err.code || 'none');
}

console.log('\n=== Step 3: isOllamaRunning() ===');
const running = await isOllamaRunning();
console.log('Result:', running);

console.log('\n=== Step 4: getOllamaModels() ===');
const models = await getOllamaModels();
console.log('Result:', models);

console.log('\n=== Step 5: resolveOllamaRuntime("llama3.2:1b") ===');
const runtime = await resolveOllamaRuntime('llama3.2:1b');
console.log('Result:', JSON.stringify(runtime));

console.log('\n=== Step 6: resolveOllamaRuntime(null) ===');
const runtimeAuto = await resolveOllamaRuntime(null);
console.log('Result:', JSON.stringify(runtimeAuto));

console.log('\n=== Step 7: Full callAI dry run ===');
import { callAI } from '../src/ai/router.js';
const result = await callAI('You are a test. Reply with just: HELLO', [{ role: 'user', content: 'say hello' }], { silent: false });
console.log('callAI result:', JSON.stringify(result, null, 2));
