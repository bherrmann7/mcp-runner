import { WorkflowRunner } from '../index.js';
import CONFIG from '../config.js';

async function getMySprintItems(mcpManager) {
    // Get the cloudId first
    const resourcesResult = await mcpManager.callTool(
        'atlassian', 'getAccessibleAtlassianResources', {}
    );
    const resources = JSON.parse(resourcesResult.content[0].text);
    const cloudId = resources[0].id;

    // Look up account ID by name
    const userLookup = await mcpManager.callTool(
        'atlassian', 'lookupJiraAccountId', {
            cloudId: cloudId,
            searchString: CONFIG.jira.assigneeName
        }
    );
    const userResult = JSON.parse(userLookup.content[0].text);
    const userList = userResult.users?.users || [];
    if (userList.length === 0) {
        throw new Error(`Could not find Jira user: ${CONFIG.jira.assigneeName}`);
    }
    const accountId = userList[0].accountId;

    // Search for all issues assigned to current user in active sprint
    const result = await mcpManager.callTool(
        'atlassian', 'searchJiraIssuesUsingJql', {
            cloudId: cloudId,
            jql: `project = ${CONFIG.jira.projectKey} AND assignee = "${accountId}" AND sprint in openSprints() ORDER BY priority DESC`,
            fields: ['summary', 'status', 'priority', CONFIG.jira.storyPointsField]
        }
    );

    console.log("=== My Current Sprint Items ===\n");

    if (result.content && result.content.length > 0) {
        let issues = JSON.parse(result.content[0].text);

        // Handle wrapped response format
        if (!Array.isArray(issues) && issues.issues) {
            issues = issues.issues;
        }

        if (Array.isArray(issues) && issues.length > 0) {
            // Define primary statuses (shown first) and sort order
            const primaryStatuses = ['QA Fail', 'In Progress', 'To Do'];
            const statusOrder = { 'QA Fail': 1, 'In Progress': 2, 'To Do': 3 };
            const priorityOrder = { 'High - A': 1, 'Medium - B': 2, 'Low - C': 3 };

            // Separate primary and other issues
            const primaryIssues = issues.filter(i => primaryStatuses.includes(i.fields?.status?.name));
            const otherIssues = issues.filter(i => !primaryStatuses.includes(i.fields?.status?.name));

            // Sort function
            const sortIssues = (a, b) => {
                const statusA = a.fields?.status?.name || '';
                const statusB = b.fields?.status?.name || '';
                const statusOrderA = statusOrder[statusA] || 99;
                const statusOrderB = statusOrder[statusB] || 99;
                if (statusOrderA !== statusOrderB) return statusOrderA - statusOrderB;
                const prioA = priorityOrder[a.fields?.priority?.name] || 99;
                const prioB = priorityOrder[b.fields?.priority?.name] || 99;
                return prioA - prioB;
            };

            primaryIssues.sort(sortIssues);
            otherIssues.sort((a, b) => {
                const statusA = a.fields?.status?.name || '';
                const statusB = b.fields?.status?.name || '';
                if (statusA === 'Done' && statusB !== 'Done') return 1;
                if (statusB === 'Done' && statusA !== 'Done') return -1;
                if (statusA !== statusB) return statusA.localeCompare(statusB);
                const prioA = priorityOrder[a.fields?.priority?.name] || 99;
                const prioB = priorityOrder[b.fields?.priority?.name] || 99;
                return prioA - prioB;
            });

            // Print table header
            const keyWidth = 10;
            const statusWidth = 12;
            const prioWidth = 12;
            const ptsWidth = 3;
            const summaryWidth = 45;
            const urlWidth = 45;

            const totalWidth = keyWidth + statusWidth + prioWidth + ptsWidth + summaryWidth + urlWidth + 15;

            const bold = (text) => `\x1b[1m${text}\x1b[0m`;

            const printRow = (issue) => {
                const status = issue.fields?.status?.name || 'Unknown';
                const isQaFail = status === 'QA Fail';
                const statusDisplay = isQaFail ? bold('QA Fail').padEnd(statusWidth + 8) : status.padEnd(statusWidth);
                const priorityRaw = issue.fields?.priority?.name || 'None';
                let priority = priorityRaw.replace(/ - [A-Z]$/, '');
                const isHigh = priority === 'High' && status !== 'Done';
                const priorityDisplay = isHigh ? bold('High').padEnd(prioWidth + 8) : priority.padEnd(prioWidth);
                const storyPoints = issue.fields?.[CONFIG.jira.storyPointsField] ?? '-';
                const url = `${CONFIG.jira.baseUrl}/browse/${issue.key}`;
                let summary = issue.fields?.summary || 'No summary';
                if (summary.length > summaryWidth) {
                    summary = summary.substring(0, summaryWidth - 3) + '...';
                }
                console.log(
                    issue.key.padEnd(keyWidth) + ' | ' +
                    statusDisplay + ' | ' +
                    priorityDisplay + ' | ' +
                    String(storyPoints).padStart(ptsWidth) + ' | ' +
                    summary.padEnd(summaryWidth) + ' | ' +
                    url
                );
            };

            console.log('-'.repeat(totalWidth));
            console.log(
                'Key'.padEnd(keyWidth) + ' | ' +
                'Status'.padEnd(statusWidth) + ' | ' +
                'Priority'.padEnd(prioWidth) + ' | ' +
                'Pts' + ' | ' +
                'Summary'.padEnd(summaryWidth) + ' | ' +
                'URL'
            );
            console.log('-'.repeat(totalWidth));

            primaryIssues.forEach(printRow);

            if (otherIssues.length > 0) {
                console.log(' '.repeat(keyWidth) + ' | ' + ' '.repeat(statusWidth) + ' | ' + ' '.repeat(prioWidth) + ' | ' + ' '.repeat(ptsWidth) + ' | ' + ' '.repeat(summaryWidth) + ' | ');
                otherIssues.forEach(printRow);
            }

            console.log('-'.repeat(totalWidth));
            console.log(`Total: ${issues.length} items (${primaryIssues.length} active, ${otherIssues.length} other)`);
        } else {
            console.log("No items found in current sprint assigned to you.");
        }
    } else {
        console.log("No results returned.");
    }
}

const runner = new WorkflowRunner(CONFIG.servers);
await runner.run(getMySprintItems);
