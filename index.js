import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createRequire} from 'module';

const require = createRequire(import.meta.url);
const {version} = require('./package.json');

/**
 * MCP Client Manager - handles connections to multiple MCP servers
 */
export class McpClientManager {
    constructor(serverConfigs = {}) {
        this.clients = new Map();
        this.serverConfigs = serverConfigs;
    }

    /**
     * Connect to an MCP server
     */
    async connect(serverName) {
        if (this.clients.has(serverName)) {
            return this.clients.get(serverName);
        }

        const config = this.serverConfigs[serverName];
        if (!config) {
            throw new Error(`Unknown server: ${serverName}. Check your config.js servers section.`);
        }

        const transport = config.url
            ? new StreamableHTTPClientTransport(new URL(config.url), {
                requestInit: config.headers ? { headers: config.headers } : undefined
            })
            : new StdioClientTransport({
                command: config.command,
                args: config.args || [],
                env: { ...process.env, ...(config.env || {}) },
                stderr: 'pipe'
            });

        const client = new Client({
            name: "mcp-runner",
            version
        }, {
            capabilities: {
                tools: {}
            }
        });

        const stderrChunks = [];
        try {
            if (transport.stderr) {
                transport.stderr.on('data', (data) => {
                    stderrChunks.push(data.toString());
                });
            }
            await client.connect(transport);
            this.clients.set(serverName, client);
            return client;
        } catch (error) {
            if (stderrChunks.length > 0) {
                console.error(`[${serverName} stderr]\n${stderrChunks.join('').trim()}`);
            }
            console.error(`Failed to connect to ${serverName}:`, error);
            throw error;
        }
    }

    /**
     * Get available tools from a server
     */
    async getTools(serverName) {
        const client = await this.connect(serverName);
        return await client.listTools();
    }

    /**
     * Call a tool on a specific server
     */
    async callTool(serverName, toolName, args = {}) {
        const client = await this.connect(serverName);
        return await client.callTool({
            name: toolName,
            arguments: args
        });
    }

    /**
     * Call a tool and parse the first content text as JSON.
     */
    async callToolJson(serverName, toolName, args = {}) {
        const result = await this.callTool(serverName, toolName, args);
        const text = result?.content?.[0]?.text;
        if (text === undefined) {
            throw new Error(`No text content in response from ${serverName}/${toolName}`);
        }
        try {
            return JSON.parse(text);
        } catch {
            // Some servers prepend non-JSON text (e.g. deprecation warnings); try to extract JSON
            // Try each [ or { candidate until one parses successfully
            let searchFrom = 0;
            while (searchFrom < text.length) {
                const idx = text.slice(searchFrom).search(/[\[{]/);
                if (idx < 0) break;
                const pos = searchFrom + idx;
                try {
                    return JSON.parse(text.slice(pos));
                } catch {
                    searchFrom = pos + 1;
                }
            }
            throw new Error(`Invalid JSON from ${serverName}/${toolName}: ${text.slice(0, 200)}`);
        }
    }

    /**
     * Close all connections
     */
    async closeAll() {
        for (const [name, client] of this.clients) {
            try {
                await client.close();
            } catch (error) {
                console.error(`Error closing ${name}:`, error);
            }
        }
        this.clients.clear();
    }
}

/**
 * Simple workflow runner
 */
export class WorkflowRunner {
    constructor(serverConfigs) {
        this.mcpManager = new McpClientManager(serverConfigs);
    }

    async run(workflow) {
        try {
            const result = await workflow(this.mcpManager);
            return result;
        } finally {
            await this.mcpManager.closeAll();
        }
    }
}
