// Simulate exactly what happens with "add all files except logs"
import { callAI } from '../src/ai/router.js';
import { getSystemInfo } from '../src/os-adapter/index.js';
import { buildContextSummary } from '../src/context/index.js';

const sys = getSystemInfo();
const ctx = buildContextSummary();

const systemPrompt = `You are a terminal command generator for ${sys.os} (PowerShell).
Output Format — STRICT
For SIMPLE tasks: Respond with ONLY the shell command. Nothing else.
For COMPLEX tasks: Respond with ONLY valid JSON.
No explanations. No markdown. No code fences. No prose.`;

const messages = [{ role: 'user', content: 'add all the files except logs and .txt' }];

console.log('=== Test 1: With validateResponse (what parseIntent does) ===');
const result1 = await callAI(systemPrompt, messages, {
  silent: true,
  validateResponse: (response) => {
    console.log('  [validate] Raw AI response:', JSON.stringify(response));
    // Re-implement the same validation as parseAIResponse
    const cleaned = response.trim();
    if (!cleaned) throw new Error('Empty response');
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    const firstLine = lines[0];
    const prosePatterns = [
      /^(here is|here's|to do|you can|i'll|i will|let me|sure,|okay,|ok,|of course)/i,
      /^```/,
      /^(in |the |this |these |those |a |an |with |for |when |if |note |please |you |we |it |by |as |at )/i,
      /\.\s+[A-Z]/,
    ];
    if (prosePatterns.some(p => p.test(firstLine) || p.test(cleaned))) {
      throw new Error(`Prose detected: "${firstLine.substring(0, 80)}"`);
    }
    return true;
  },
});
console.log('Result:', JSON.stringify(result1, null, 2));

console.log('\n=== Test 2: Without validateResponse (raw) ===');
const result2 = await callAI(systemPrompt, messages, { silent: true });
console.log('Result:', JSON.stringify(result2, null, 2));
