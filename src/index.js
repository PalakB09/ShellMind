#!/usr/bin/env node

// AI CLI — Main entrypoint
// A production-grade AI-powered CLI assistant for terminal control via natural language.

import dotenv from 'dotenv';
import { handleInput } from './router/index.js';

// Load .env file if present (for GEMINI_API_KEY)
dotenv.config();

handleInput(process.argv.slice(2)).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
