# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP Runner is a JavaScript framework for executing automated workflows against Model Context Protocol (MCP) servers. The concept is "LLM to script" — workflows explored interactively with Claude get compiled into fast, repeatable JavaScript that calls MCP servers directly without an LLM.

## Commands

- `npm install` — install dependencies
- `node examples/<workflow>.js` — run a specific workflow (e.g., `node examples/setWorkDayAlarms.js`, `node examples/jira.js`)
- `node examples/list-tools.js` — discover available tools on an MCP server

There is no build step, linter, or test framework configured.

## Architecture

**ES Modules** — the project uses `"type": "module"` with `import`/`export` syntax throughout.

**Core framework** (`index.js`):
- `McpClientManager` — manages connections to multiple MCP servers via `@modelcontextprotocol/sdk`. Connects lazily on first use, caches clients in a `Map`, and provides `callTool(serverName, toolName, args)` and `getTools(serverName)`. Takes server configs as a constructor parameter.
- `WorkflowRunner` — takes server configs and a workflow function `(mcpManager) => result`, runs it, and guarantees `closeAll()` cleanup in `finally`.

**Server configs** are defined in `config.js` (gitignored). Copy `config.example.js` to get started. The `servers` section maps server names to their stdio command/args/env.

**Workflow scripts** live in `examples/` and import from `../index.js` and `../config.js`:
- `setWorkDayAlarms.js` — fetches Google Calendar events and sets Android alarms via ADB. Supports `-na`/`--no-alarm` flag.
- `jira.js` — queries Jira sprint items via Atlassian MCP server. Uses `config.jira` for credentials/settings.
- `list-inbox.js` — lists Gmail inbox subjects via the gmail MCP server.
- `list-tools.js` — utility to discover tools available on an MCP server.

## Configuration

`config.js` is gitignored and contains user-specific settings (server paths, Jira URL, project key, etc.). Copy `config.example.js` to `config.js` to set up.
