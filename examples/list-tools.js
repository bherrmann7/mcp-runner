import { WorkflowRunner } from '../index.js';
import CONFIG from '../config.js';

const runner = new WorkflowRunner(CONFIG.servers);
await runner.run(async (mcpManager) => {
  console.log("=== Listing Google Calendar Server Tools ===");
  const calendarTools = await mcpManager.getTools('google-calendar');
  console.log("Google Calendar tools:", JSON.stringify(calendarTools, null, 2));
});
