// Batch-fetch Jira issue statuses for a dashboard
// Usage: node jira-statuses.js PROJ-123 PROJ-124 PROJ-125 ...
// Output: JSON object { "PROJ-123": "Done", "PROJ-124": "In Progress", ... }

import { WorkflowRunner } from '../index.js';
import CONFIG from '../config.js';

const keys = process.argv.slice(2);
if (keys.length === 0) {
    console.log('{}');
    process.exit(0);
}

async function fetchStatuses(mcpManager) {
    const cloudId = CONFIG.jira.cloudId;

    const jql = `key in (${keys.join(',')})`;
    let issues = await mcpManager.callToolJson(
        'atlassian', 'searchJiraIssuesUsingJql', {
            cloudId,
            jql,
            maxResults: keys.length,
            fields: ['status']
        }
    );

    if (!Array.isArray(issues) && issues?.issues) {
        issues = issues.issues;
    }

    const result = {};
    if (Array.isArray(issues)) {
        for (const issue of issues) {
            result[issue.key] = issue.fields?.status?.name || 'Unknown';
        }
    }

    // Output JSON to stdout
    console.log(JSON.stringify(result));
}

async function main() {
    const runner = new WorkflowRunner(CONFIG.servers);
    try {
        await runner.run(fetchStatuses);
    } catch (error) {
        console.error("Failed:", error.message);
        console.log('{}');
        process.exit(1);
    }
}

main();
