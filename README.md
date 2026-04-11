<div align="center">
  <h1>🧠 AI CLI Assistant</h1>
  <p><b>Your terminal, hypercharged with natural language intelligence.</b></p>
  <p>Stop Googling shell commands. Stop digging through terminal histories. Speak to your CLI, and watch it work.</p>
</div>

---

## ⚡ Why We Built This

Modern development is fast, but terminal workflows are still stuck in the 90s. How often do you find yourself Googling *"how to kill process on port 3000"* or *"git undo last commit without losing changes"*? 

We built the **AI CLI Assistant** to bridge the gap between natural human intent and rigid shell syntax. Whether you are a lead DevOps engineer managing complex Docker teardowns, or a new associate trying to spin up a legacy repository, this tool gives you a conversational, intelligent pair programmer living right directly inside your terminal environment.

Best of all? **It respects your wallet.** Built with an intelligent multi-provider routing engine, it defaults to entirely free, zero-cost LLM endpoints under the hood, only falling back to paid APIs when you explicitly configure it to. 

No API key? No problem. The tool gracefully degrades into a powerful local command-alias manager designed for engineering teams.

---

## 🚀 Quick Install

Since you have the source code locally, you can install it globally on your machine and make the `ai` command universally available without publishing it to NPM.

Navigate to the project root and run:

```bash
npm install
npm link
```

Now, the `ai` command is completely accessible from any terminal window! Try running:

```bash
ai "find all big files and delete them"
```

---

## 🛠️ The Dual Engine: How It Works

We designed this for two types of users:

### 1. The Power-User (API Enabled)
If you provide an API Key, the tool transforms into an intelligent shell agent. It parses your natural language, writes the perfect OS-specific shell commands, runs them through local safety guardrails (preventing `rm -rf /` catastrophes), and executes them. Keep it zero-cost by using OpenRouter free models, or hook up your premium Gemini keys.

### 2. The Local Team (Offline / Basic Mode)
Don't want to use AI? You can still use the CLI purely as a **Workflow Memory Engine**. You can record complex chains of bash scripts, name them, and execute them universally. Extremely powerful for onboarding new team members who don't know your custom build scripts.

---

## 💡 15 Powerful Real-World Use Cases

Here is exactly what you can do with this product today.

### Intelligent Autonomous Workflows (API Enabled)

**1. The Magic Setup**
Just cloned a repo? Don't look for the docs. 
```bash
ai setup this repo
```
*(The CLI scans the folder, detects Node/Python/Go environments, installs dependencies, and boots the project)*

**2. Port Hunting & Killing**
```bash
ai kill whatever process is holding port 3000 hostage
```

**3. Git Rescue Operations**
```bash
ai "I messed up my last commit, undo it but keep my files so I can edit them"
```

**4. Log Diagnostics**
```bash
ai find all ERROR lines in server.log from the past 24 hours and export them to issues.txt
```

**5. System Diagnostics**
```bash
ai show me the top 5 most memory-heavy processes currently running
```

**6. Docker Teardown**
```bash
ai stop and remove all dangling docker containers, images, and volumes
```

**7. Massive Asset Renaming**
```bash
ai rename all .jpeg files in the images directory to .jpg
```

**8. Advanced Git Commits**
```bash
ai add everything and commit with message 'Fixed the memory leak in the router' and push
```

**9. Disk Space Recovery**
```bash
ai find and safely delete all node_modules folders recursively in this directory tree
```

**10. Safe Package Upgrades**
```bash
ai safely update all minor npm packages without major breaking changes
```

### Team Memory & Automation (No-Key / Basic Mode)

Don't want to use AI at all? Use our powerful workflow alias engine to standardize scripts across your entire engineering team.

**11. Team Onboarding Macros**
Write a complex 10-step server boot process once, then save it globally:
```bash
ai save -g boot-local-stack
```
New developers can now simply type `ai run boot-local-stack` instead.

**12. Standardized Deployments**
Save repetitive build steps for production:
`npm run lint && npm build && firebase deploy` -> `ai save deploy-prod`
Run instantly:
```bash
ai run deploy-prod
```

**13. Local Database Nukes (Environment Resets)**
Save a script to drop your local Postgres arrays, recreate the schema, and spawn the seeds.
```bash
ai run reset-db
```

**14. Cross-Project Aliasing**
Store your favorite global git command standard: `ai save -g push-all`. This is now accessible universally across any project terminal on your machine.

**15. Workflow Library Reference**
Forget what scripts your team saved? Just list them dynamically:
```bash
ai list
```

---

## ⚙️ Configuration & API Setup

To unlock the natural language generation, provide an API key. 
In your home directory, create `~/.ai-cli/config.json`:

```json
{
  "provider": "openrouter",
  "apiKeys": {
    "openrouter": "sk-or-...",
    "gemini": "AIzaSy..."
  },
  "models": [
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-3-27b-it:free"
  ],
  "defaultMode": "execute"
}
```

**Smart Fallbacks:** Our router natively detects when an API provider is rate-limited (HTTP 429) or offline, automatically cascading through your priority models until it finds one that works, ensuring you never face crashes.

*(Note: You can also just drop a `.env` file containing `GEMINI_API_KEY` or `OPENROUTER_API_KEY` in the execution directory!)*

---

## 🛡️ Built-In Guardrails

This isn't a naive wrapper. We built a proactive, 3-tier safety layer that intercepts commands before execution.

- **Safe:** Direct execution. (e.g., `ls`, `cat`, `git status`)
- **Caution:** Prompts for your approval. (e.g., `git push`, `docker kill`)
- **Dangerous:** Extreme warnings and strict manual override required. Prevents AI hallucinations from deleting your system `(rm -rf /*)`.

---

## 💬 Interactive Chat REPL

Need back-and-forth debugging? Enter the chat REPL matrix:

```bash
ai chat
```
Inside the matrix, you gain context-awareness. You can type: 
`ai> list files` 
`ai> filter that to only json files`
`ai> delete them`

---

Ready to upgrade your terminal? **Try it today.**
