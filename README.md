<div align="center">
  <h1>AI CLI Assistant</h1>
  <p><b>Your terminal, hypercharged with natural language intelligence and automated offline project workflows.</b></p>
  
  <!-- TODO: Replace these with actual repository badges once published -->
  <a href="https://www.npmjs.com/package/shellmind"><img src="https://img.shields.io/npm/v/shellmind.svg?style=flat-square" alt="NPM Version"></a>
  <a href="https://github.com/yourusername/ai-in-cli/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square" alt="PRs Welcome">
</div>

---

<!-- TODO: INSERT 15-SECOND DEMO GIF HERE. 
     Show a side-by-side or fast transition of:
     1. `ai stop port 3000` (AI mode)
     2. `ai run db-reset` (Workflow mode) -->
> **[TODO: Insert high-quality terminal GIF recorded with VHS or CleanShot here]**

## Overview

We built the **AI CLI Assistant** to act as a dual-engine pair programmer living directly in your terminal. It replaces context-switching to browser-based AIs and eliminates the need for messy, syntax-heavy bash scripts. 

It operates via two distinct engines:
1. **Intelligent AI Engine (Privacy-First):** Speak to your terminal in natural language (`ai kill the process on port 3000`), and it generates, evaluates, and safely executes OS-specific shell code. Plugs directly into local Ollama models by default.
2. **Team Workflow Engine (100% Offline):** A modern replacement for `Makefiles`. Clone any repository containing an `ai-commands.md` file, and natively run project-specific shell macros with zero internet connection required.

## Why use this over Makefiles?

Traditional Makefiles and Bash scripts are prone to syntax errors, hard to read, and difficult to construct for complex pipelines. 

By simply placing an `ai-commands.md` file at the root of your repo, the CLI parses standard Markdown as executable code. 

### The Old Way (`Makefile`)
```makefile
.PHONY: reset-db
reset-db:
	@echo "Resetting database..."
	docker-compose down -v
	docker-compose up -d postgres
	sleep 5
	npm run db:migrate
	npm run db:seed
```

### The Modern Way (`ai-commands.md`)
```markdown
## reset-db
Nukes and recreates the docker database instances and runs seedings.

\`\`\`bash
docker-compose down -v
docker-compose up -d postgres
npm run db:migrate
npm run db:seed
\`\`\`
```
*Run it instantly:* `$ ai run reset-db`

---

## 🚀 Installation

**Via NPM (Recommended):**
```bash
npm install -g shellmind
```

**Local Development (For Contributors):**
```bash
git clone https://github.com/yourusername/ai-in-cli.git
cd ai-in-cli
npm install
npm link
```

**First-time setup — run the onboarding wizard:**
```bash
ai init
```
This detects your local Ollama installation, walks you through model selection (Fast/Balanced/Powerful), and optionally configures a Gemini API key as a cloud fallback. Your config is saved to `~/.ai-cli/config.json`.

Verify the installation:
```bash
ai --version
```

## 🧠 Mode 1: The AI Co-Pilot

If you pass natural language to the CLI, it provisions the command for your specific OS and hardware.

### Single-Shot Execution
Fire and forget. The CLI determines the right commands, explains them, and asks to run them.
```bash
ai scaffold an entire NextJS repo here
ai stop and remove all dangling docker containers
ai show me the top 5 most memory heavy processes
```

### Interactive Chat REPL
Need stateful conversation and debugging? Enter the chat matrix to talk *about* the things you just executed in standard output.
```bash
$ ai chat
ai> list the files in this directory
[CLI executes `ls -la`]
ai> delete the three oldest ones
[CLI executes `rm`]
```

## ⚡ Mode 2: Team Workflows (Zero AI / Offline)

Zero API keys required. The CLI acts as a universal macro runner to execute saved workflows.

### Workflow Commands
```bash
ai run <macro-name>      # Execute a macro from ai-commands.md natively
ai save <workflow-name>  # Appends the last command you ran to ai-commands.md
ai save -g <name>        # Saves a macro globally to ~/.ai-cli/commands.json
ai list                  # Lists all available macros in the current directory
```

## ⚙️ Configuration & Architecture

The tool uses a **Waterfall Routing** system to minimize latency and API costs.
1. Local Workflows > Global Workflows > Cached Memory > Defaults > Local AI > Cloud AI

### Model Setup
The CLI defaults to 100% local, private execution if Ollama is detected.
- **Ollama**: Automatically detected at `localhost:11434`. (Default model: `llama3.2:1b`)
- **Gemini Fallback**: If Ollama goes down, the system instantly self-heals by routing to Gemini.

You can configure fallback providers via `~/.ai-cli/config.json`:
```json
{
  "provider": "ollama",
  "apiKeys": { 
    "gemini": "YOUR_GEMINI_KEY" 
  }
}
```

## 🔒 Security & Privacy Guarantee

As an execution layer interacting with your root machine, we take security seriously:
- **Zero Telemetry**: We do not track your commands, IP, or repository contents.
- **Local Isolation**: If executing via Ollama, your codebase and prompts literally never leave your machine.
- **Proactive Sandboxing**: A 3-tier lexographic safety engine containing over 50 blocklist parameters intercepts commands before execution.
  - **Tier 1 (Safe):** (e.g., `git log`). Auto-execution allowed.
  - **Tier 2 (Caution):** Pauses for human Y/N confirmation.
  - **Tier 3 (Dangerous):** (e.g., `rm -rf`, `mkfs`). Halts execution entirely with large warnings to prevent agentic hallucination wipes.

## 🗺️ Roadmap & Contributing

We are actively building the future of local-first agentic scripting. 
- [ ] Context-aware RAG over local project files
- [ ] Anthropic Claude 3.5 Sonnet Integration
- [ ] Windows PowerShell native command translation improvements

**Contributing:**
PRs are welcome! Check out our [Issues](#) page and look for the `Good First Issue` tag.

---
<div align="center">
  <b>If you find this project useful, please consider leaving a ⭐!</b>
</div>
