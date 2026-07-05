// Read a Jira issue and output key fields as JSON
// Usage: node jira-read.js PROJ-123
// Output: { "key": "PROJ-123", "summary": "...", "status": "...", "description": "...", "acceptanceCriteria": "...", "comments": [...] }

import { WorkflowRunner } from '../index.js';
import CONFIG from '../config.js';

const issueKey = process.argv[2];
if (!issueKey) {
    console.error('Usage: node jira-read.js <issue-key>');
    process.exit(1);
}

// Flatten Atlassian Document Format (ADF) to plain text
function adfToText(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return node.attrs?.text || '';
    if (node.type === 'inlineCard') return node.attrs?.url || '';

    const children = (node.content || []).map(adfToText).join('');

    switch (node.type) {
        case 'paragraph':     return children + '\n';
        case 'heading':       return children + '\n';
        case 'bulletList':    return children;
        case 'orderedList':   return children;
        case 'listItem':     return '- ' + children;
        case 'codeBlock':    return children + '\n';
        case 'blockquote':   return '> ' + children;
        case 'table':        return children;
        case 'tableRow':     return children + '\n';
        case 'tableCell':
        case 'tableHeader':  return children + '\t';
        default:             return children;
    }
}

async function readIssue(mcpManager) {
    const cloudId = CONFIG.jira.cloudId;

    const issue = await mcpManager.callToolJson(
        'atlassian', 'getJiraIssue', {
            cloudId,
            issueIdOrKey: issueKey
        }
    );

    const fields = issue.fields || {};
    const result = {
        key: issue.key,
        summary: fields.summary || '',
        status: fields.status?.name || '',
        priority: fields.priority?.name || '',
        type: fields.issuetype?.name || '',
        description: fields.description || null,
        comments: []
    };

    // Extract and flatten comments
    const commentData = fields.comment?.comments || [];
    result.comments = commentData.map(c => ({
        author: c.author?.displayName || '',
        created: c.created || '',
        body: adfToText(c.body).trim()
    }));

    console.log(JSON.stringify(result, null, 2));
}

async function main() {
    const runner = new WorkflowRunner(CONFIG.servers);
    try {
        await runner.run(readIssue);
    } catch (error) {
        console.error("Failed:", error.message);
        process.exit(1);
    }
}

main();
