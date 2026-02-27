import { McpClientManager } from '../index.js';
import CONFIG from '../config.js';

async function listTools() {
  const mcpManager = new McpClientManager(CONFIG.servers);

  try {
    console.log("=== Listing Google Calendar Server Tools ===");
    const calendarTools = await mcpManager.getTools('google-calendar');
    console.log("Google Calendar tools:", JSON.stringify(calendarTools, null, 2));

  } catch (error) {
    console.error("Error:", error);
  } finally {
    await mcpManager.closeAll();
  }
}

listTools();
