<div align="center">
  <h1>🧠 AI CLI Assistant</h1>
  <p><b>Your terminal, hypercharged with natural language intelligence & automated offline project workflows.</b></p>
</div>

---

## ⚡ What is this?

We built the **AI CLI Assistant** to act as a dual-engine pair programmer living directly in your terminal. It has two distinct modes depending on your configuration:

1. **Intelligent AI Engine:** Speak to your terminal in natural language (`ai kill the process on port 3000`), and it will write, evaluate, and safely execute OS-specific shell code for you.
2. **Team Workflow Engine (100% Offline):** It acts as an open-source script runner for development teams. Clone any repository containing an `ai-commands.md` file, and natively run project-specific shell macros with zero internet connection or AI keys required!

---

## 🚀 Quick Install

To make the `ai` command universally available on your local machine:

```bash
# Since the code is currently local, link it to your global path:
npm install
npm link
```

Verify the installation by running:
```bash
ai --version
```

---

## 🟢 MODE 1: The AI Co-Pilot (API Enabled)

If you configure an API Key, the tool transforms into an intelligent shell agent. It parses your natural language, writes OS-specific shell commands, executes them through a safety layer, and automatically self-heals terminal errors.

### 🔑 Configuration Setup
Create a globally accessible configuration file at `~/.ai-cli/config.json`:

```json
{
  "provider": "gemini",
  "apiKeys": { 
    "gemini": "YOUR_GEMINI_KEY",
    "openrouter": "OPTIONAL_FALLBACK_KEY"
  },
  "models": ["gemini-2.5-pro", "gemini-2.5-flash"]
}
```
*(You can also simply drop a `.env` file containing `GEMINI_API_KEY` into your current working directory).*

**Smart Network Routing:** Our built-in intelligence dynamically cascades between your specified models. If `gemini-2.5-pro` hits an HTTP 429 Rate Limit, we instantly funnel the execution down to `gemini-2.5-flash` so you physically never experience a crash!

### ✨ Feature 1: Single Shot Execution (`ai <instruction>`)
Fire and forget. The CLI determines the right commands for your specific Operating System (Mac, Windows, Linux) and asks to run them.

```bash
# Scaffold an entire repo
ai setup this repo

# Clean up docker environments safely
ai stop and remove all dangling docker containers, volumes, and images

# Diagnose processes
ai show me the top 5 most memory heavy processes

# Git operations
ai add everything, commit with message 'Fixed routing bug' and push to main
```

### ✨ Feature 2: Interactive Chat REPL (`ai chat`)
Need stateful conversation and debugging? Enter the chat matrix. It stores terminal standard output into a rolling buffer window, meaning you can talk *about* the things you just executed.

```bash
$ ai chat
ai> list the files in this directory
[CLI executes `ls -la`]
ai> delete the three oldest ones
[CLI reads context, identifies the specific older files, executes `rm`]
```

### ✨ Feature 3: Execution Flags
Manage the AI's autonomy with granular flag control:
* `ai [instruction] --dry-run` : Generates the execution plan and prints it, but strictly terminates the process before running it.
* `ai [instruction] --auto` : Strips away confirmation prompts allowing fully headless background execution *(Safety Note: Danger Tier 3 commands will artificially override this flag and force manual entry).*

---

## 🔵 MODE 2: Team Workflows (Zero AI / Offline)

Don't want to use AI? Dealing with API quotas? 

The tool seamlessly doubles as a **Universal Repository Macro Runner**. It replaces messy Bash scripts with highly readable standard Markdown files. Any team member can use it.

### ✨ Feature 4: Creating Repo Commands (`ai-commands.md`)
Open Source maintainers simply drop an `ai-commands.md` in the root of their repository. It acts as standard documentation but is tightly integrated with our CLI.

*(Example repository file: `ai-commands.md`)*
> ## reset-database
> Nukes and recreates the docker database instances and runs seedings.
> \`\`\`bash
> docker-compose down -v
> docker-compose up -d postgres
> npm run db:migrate
> npm run db:seed
> \`\`\`

### ✨ Feature 5: Native Execution (`ai run`)
If you clone a repo containing the `.md` file, you don't copy-paste commands anymore. You just ask the AI tool to run it natively off the markdown AST:
```bash
ai run reset-database
```
*It parses the file, isolates the bash codeblock, and executes it step by step.*

### ✨ Feature 6: Saving Workflows (`ai save`)
Did you just execute a complex 4-step pipeline manually and want to save it to your repo's Markdown file for your coworkers? 
```bash
# This searches for the last command you executed and injects it to the bottom of the Markdown file
ai save brand-new-workflow
```

### ✨ Feature 7: Global Cross-Repo Macros (`ai save -g`)
Want a command universally accessible regardless of what directory repository you open terminal in? Simply pass the Global flag.
```bash
# Saves pushing logic locally to ~/.ai-cli/commands.json
ai save -g force-push
```

### ✨ Feature 8: Listing Workflows (`ai list`)
Forget what scripts your team saved? Print them dynamically.
```bash
ai list
```

---

## 🛡️ Built-In Guardrails

This isn't a naive, dangerous wrapper. The CLI executes arbitrary text on a user's machine root, so we built a proactive, 3-tier lexographic safety engine containing over 50 blocklist evaluation parameters that intercepts commands before execution.

- **🟢 Tier 1 (Safe):** (e.g., `git log`, `npm test`, `pwd`). Grants automatic execution under `--auto`.
- **🟡 Tier 2 (Caution):** (e.g., `git push`, `docker kill`, `systemctl restart`). The system pauses asking a human for `Y/N` confirmation.
- **🔴 Tier 3 (Dangerous):** (e.g., `rm -rf`, `mkfs`, `curl | bash`, `chmod 777`). Halts execution entirely with massive red styling. Extreme manual overrides are required to prevent AI hallucination system-wipes.
