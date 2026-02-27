import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

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

        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args || [],
            env: config.env || {},
            stderr: 'pipe'
        });

        const client = new Client({
            name: "mcp-runner",
            version: "1.0.0"
        }, {
            capabilities: {
                tools: {}
            }
        });

        try {
            transport.stderr?.on('data', (data) => {
                console.error(`[${serverName} stderr] ${data.toString().trim()}`);
            });
            await client.connect(transport);
            this.clients.set(serverName, client);
            return client;
        } catch (error) {
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
