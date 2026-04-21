import readline from 'readline';

async function promptConfirmation(message) {
  return new Promise((resolve) => {
    const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl2.question(`\n${message}\nConfirm (y/n): `, (answer) => {
      rl2.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function startREPL() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'repl> '
  });

  rl.prompt();

  let processing = false;
  rl.on('line', async (line) => {
    if (processing) return;
    const input = line.trim();
    if (input === 'exit') {
      rl.close();
      return;
    }

    processing = true;
    console.log(`Processing: ${input}`);
    
    // THE FIX: Pause AND ignore lines
    rl.pause(); 
    const result = await promptConfirmation('Action needed');
    rl.resume();
    processing = false;
    
    console.log(`Sub-prompt result: ${result}`);
    rl.prompt();
  });
}

startREPL();
