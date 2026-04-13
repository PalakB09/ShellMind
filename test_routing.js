import { callAI } from './src/ai/router.js';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  console.log('Testing Ollama -> Gemini fallback...');
  
  const systemPrompt = 'You are a unit tester.';
  const messages = [{ role: 'user', content: 'test' }];

  try {
    const result = await callAI(systemPrompt, messages, { silent: false });
    console.log('\nResult:', JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('CRASHED:', err);
    process.exit(1);
  }
}

test();
