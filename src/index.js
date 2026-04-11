#!/usr/bin/env node

// AI CLI — Main entrypoint
// A production-grade AI-powered CLI assistant for terminal control via natural language.

import dotenv from 'dotenv';
import { createCLI } from './cli/index.js';

// Load .env file if present (for GEMINI_API_KEY)
dotenv.config();

const program = createCLI();

// Parse command-line arguments and run
program.parseAsync(process.argv).catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
