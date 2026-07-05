// Transition a Jira issue to a new status
// Usage: node jira-transition.js PROJ-123 "PR Review"
//        node jira-transition.js PROJ-123 "In Progress"
// Looks up available transitions by name and applies the match.

import { WorkflowRunner } from '../index.js';
import CONFIG from '../config.js';

const issueKey = process.argv[2];
const targetStatus = process.argv[3];

if (!issueKey || !targetStatus) {
    console.error('Usage: node jira-transition.js <issue-key> <status-name>');
    console.error('Example: node jira-transition.js PROJ-123 "PR Review"');
    process.exit(1);
}

async function transitionIssue(mcpManager) {
    const cloudId = CONFIG.jira.cloudId;

    // Get available transitions for this issue
    const transitions = await mcpManager.callToolJson(
        'atlassian', 'getTransitionsForJiraIssue', {
            cloudId,
            issueIdOrKey: issueKey
        }
    );

    const available = transitions.transitions || transitions || [];
    const match = available.find(t =>
        t.name.toLowerCase() === targetStatus.toLowerCase()
    );

    if (!match) {
        const names = available.map(t => `"${t.name}"`).join(', ');
        console.error(`No transition "${targetStatus}" available for ${issueKey}.`);
        console.error(`Available: ${names}`);
        process.exit(1);
    }

    // Apply the transition
    await mcpManager.callTool(
        'atlassian', 'transitionJiraIssue', {
            cloudId,
            issueIdOrKey: issueKey,
            transition: { id: match.id }
        }
    );

    console.log(`${issueKey}: ${match.name}`);
}

async function main() {
    const runner = new WorkflowRunner(CONFIG.servers);
    try {
        await runner.run(transitionIssue);
    } catch (error) {
        console.error("Failed:", error.message);
        process.exit(1);
    }
}

main();
