import { WorkflowRunner } from '../index.js';
import CONFIG from '../config.js';

const workflow = async (mcpManager) => {
    // Search for recent emails in inbox
    const result = await mcpManager.callTool('gmail', 'search_emails', {
        query: 'in:inbox',
        maxResults: 20
    });

    // Parse and display subjects
    const data = JSON.parse(result.content[0].text);
    const emails = data.emails || data;

    console.log('\n📬 Inbox Subjects:\n');
    emails.forEach((email, i) => {
        const subject = email.subject || email.snippet || '(no subject)';
        const from = email.from || '';
        console.log(`${i + 1}. ${subject}`);
        if (from) console.log(`   From: ${from}\n`);
    });

    console.log(`\nTotal: ${emails.length} emails`);
};

new WorkflowRunner(CONFIG.servers).run(workflow);
