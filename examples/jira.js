import { WorkflowRunner } from '../index.js';
import CONFIG from '../config.js';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

async function getMySprintItems(mcpManager) {
    const cloudId = CONFIG.jira.cloudId;

    // Search for issues assigned to me in active sprint
    let issues = await mcpManager.callToolJson(
        'atlassian', 'searchJiraIssuesUsingJql', {
            cloudId: cloudId,
            jql: `project = ${CONFIG.jira.projectKey} AND assignee = currentUser() AND (sprint in openSprints() OR sprint in futureSprints()) ORDER BY priority DESC`,
            maxResults: 50,
            fields: ['summary', 'status', 'priority', 'customfield_10020', CONFIG.jira.storyPointsField]
        }
    );

    console.log("=== My Current Sprint Items ===\n");

    if (issues) {

        // Handle wrapped response format
        if (!Array.isArray(issues) && issues.issues) {
            issues = issues.issues;
        }

        // Filter out Done and Duplicate issues
        if (Array.isArray(issues)) {
            issues = issues.filter(i => {
                const status = i.fields?.status?.name || '';
                return status !== 'Done' && status !== 'Duplicate';
            });
        }

        if (Array.isArray(issues) && issues.length > 0) {
            // Define primary statuses (shown first) and sort order
            const primaryStatuses = ['QA Fail', 'In Progress', 'To Do'];
            const statusOrder = { 'QA Fail': 1, 'In Progress': 2, 'To Do': 3 };
            const priorityOrder = { 'High - A': 1, 'Medium - B': 2, 'Low - C': 3 };

            // Get sprint sort order: active sprint first, then next future sprint, then others
            // Extract sprint number from name (e.g., "Sprint 46" -> 46) for numeric ordering
            const getSprintOrder = (issue) => {
                const sprints = issue.fields?.customfield_10020;
                if (!sprints || sprints.length === 0) return { order: 9999, name: '' };
                const sprint = sprints[sprints.length - 1];
                const numMatch = sprint.name.match(/(\d+)/);
                const sprintNum = numMatch ? parseInt(numMatch[1], 10) : 9999;
                if (sprint.state === 'active') return { order: sprintNum, name: sprint.name };
                if (sprint.state === 'future') return { order: sprintNum, name: sprint.name };
                // Non-active/future (e.g., REFINEMENT, QA backlog) sort after numbered sprints
                return { order: 5000 + sprintNum, name: sprint.name };
            };

            // Separate primary and other issues
            const primaryIssues = issues.filter(i => primaryStatuses.includes(i.fields?.status?.name));
            const otherIssues = issues.filter(i => !primaryStatuses.includes(i.fields?.status?.name));

            // Sort function: sprint number first, then priority
            const sortIssues = (a, b) => {
                const sprintA = getSprintOrder(a);
                const sprintB = getSprintOrder(b);
                if (sprintA.order !== sprintB.order) return sprintA.order - sprintB.order;
                const prioA = priorityOrder[a.fields?.priority?.name] || 99;
                const prioB = priorityOrder[b.fields?.priority?.name] || 99;
                return prioA - prioB;
            };

            primaryIssues.sort(sortIssues);
            otherIssues.sort(sortIssues);

            // Print table header
            const numWidth = 3;
            const keyWidth = 10;
            const statusWidth = 12;
            const prioWidth = 12;
            const ptsWidth = 3;
            const sprintWidth = 25;
            const summaryWidth = 92;

            const totalWidth = numWidth + keyWidth + statusWidth + prioWidth + ptsWidth + sprintWidth + summaryWidth + 18;

            const bold = (text) => `\x1b[1m${text}\x1b[0m`;
            const dim = (text) => `\x1b[2m${text}\x1b[0m`;

            // Collect all issues in display order for numbering
            const allOrdered = [...primaryIssues, null, ...otherIssues];
            const issueMap = [];
            let rowNum = 0;

            const printRow = (issue) => {
                rowNum++;
                issueMap.push(issue.key);
                let status = issue.fields?.status?.name || 'Unknown';
                if (status.length > statusWidth) status = status.substring(0, statusWidth);
                const isQaFail = status === 'QA Fail';
                // +8 accounts for ANSI bold escape codes (\x1b[1m and \x1b[0m) which are 8 bytes but zero display width
                const statusDisplay = isQaFail ? bold('QA Fail').padEnd(statusWidth + 8) : status.padEnd(statusWidth);
                const priorityRaw = issue.fields?.priority?.name || 'None';
                let priority = priorityRaw.replace(/ - [A-Z]$/, '');
                const isHigh = priority === 'High' && status !== 'Done';
                // +8 accounts for ANSI bold escape codes (\x1b[1m and \x1b[0m) which are 8 bytes but zero display width
                const priorityDisplay = isHigh ? bold('High').padEnd(prioWidth + 8) : priority.padEnd(prioWidth);
                const storyPoints = issue.fields?.[CONFIG.jira.storyPointsField] ?? '-';
                const sprints = issue.fields?.customfield_10020;
                let sprintName = sprints && sprints.length > 0 ? sprints[sprints.length - 1].name : '';
                sprintName = sprintName.replace(/^SMART PS - /, '');
                if (sprintName.length > sprintWidth) sprintName = sprintName.substring(0, sprintWidth);
                let summary = issue.fields?.summary || 'No summary';
                if (summary.length > summaryWidth) {
                    summary = summary.substring(0, summaryWidth - 3) + '...';
                }
                console.log(
                    dim(String(rowNum).padStart(numWidth)) + ' ' +
                    issue.key.padEnd(keyWidth) + ' | ' +
                    statusDisplay + ' | ' +
                    priorityDisplay + ' | ' +
                    String(storyPoints).padStart(ptsWidth) + ' | ' +
                    sprintName.padEnd(sprintWidth) + ' | ' +
                    summary
                );
            };

            console.log('-'.repeat(totalWidth));
            console.log(
                ' '.repeat(numWidth) + ' ' +
                'Key'.padEnd(keyWidth) + ' | ' +
                'Status'.padEnd(statusWidth) + ' | ' +
                'Priority'.padEnd(prioWidth) + ' | ' +
                'Pts' + ' | ' +
                'Sprint'.padEnd(sprintWidth) + ' | ' +
                'Summary'
            );
            console.log('-'.repeat(totalWidth));

            primaryIssues.forEach(printRow);

            if (otherIssues.length > 0) {
                console.log('');
                otherIssues.forEach(printRow);
            }

            console.log('-'.repeat(totalWidth));
            console.log(`Total: ${issues.length} items (${primaryIssues.length} active, ${otherIssues.length} other)`);

            // Save issue map for "open #N" command
            const mapFile = join(homedir(), '.jira-issues.json');
            writeFileSync(mapFile, JSON.stringify(issueMap.map((key, i) => ({
                num: i + 1,
                key,
                url: `${CONFIG.jira.baseUrl}/browse/${key}`
            })), null, 2));
        } else {
            console.log("No items found in current sprint assigned to you.");
        }
    } else {
        console.log("No results returned.");
    }
}

async function main() {
    const runner = new WorkflowRunner(CONFIG.servers);
    try {
        await runner.run(getMySprintItems);
    } catch (error) {
        console.error("Script failed:", error);
        process.exit(1);
    }
}

main();
