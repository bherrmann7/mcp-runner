# MCP Runner

A lightweight framework for running automated workflows using MCP servers — no LLM required.

## The Idea

MCP servers give AI tools like Claude access to a rich ecosystem of integrations (calendars, databases, IDEs, email, etc.). But many repetitive tasks don't need an LLM — they just need access to those same integrations.

MCP Runner lets you write plain JavaScript workflows that call MCP server tools directly. You get the breadth of the MCP ecosystem with the speed and predictability of a script.

## Setup

```bash
npm install
cp config.example.js config.js  # customize for your environment
```

## Usage

```javascript
import { WorkflowRunner } from './index.js';

async function myWorkflow(mcpManager) {
  const result = await mcpManager.callTool(
    'google-calendar',
    'list_events',
    { account: 'work', calendarId: 'primary', timeMin: '2025-01-01T00:00:00', timeMax: '2025-01-02T00:00:00' }
  );

  const events = JSON.parse(result.content[0].text);
  console.log(`Found ${events.Events.length} events`);
  return events;
}

const runner = new WorkflowRunner();
await runner.run(myWorkflow);
```

## How It Works

- **`McpClientManager`** — connects to MCP servers on demand via stdio, manages their lifecycle
- **`WorkflowRunner`** — executes a workflow function and cleans up connections when done

Server configs are defined in `index.js`. Add any MCP server that speaks stdio.

## The Pattern

1. Explore interactively with Claude + MCP servers
2. Identify the repetitive parts
3. "Compile" them into a workflow script 
   4. you can hand write the js for calling the endpoings
   5. or you can ask claude to write the js
4. Run it directly — fast, repeatable, no tokens burned
