import { WorkflowRunner } from '../index.js';
import CONFIG from '../config.js';

const workflow = async (mcpManager) => {
    // Search for recent emails in inbox
    const data = await mcpManager.callToolJson('gmail', 'search_emails', {
        query: 'in:inbox',
        maxResults: 20
    });

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

async function main() {
    const runner = new WorkflowRunner(CONFIG.servers);
    try {
        await runner.run(workflow);
    } catch (error) {
        console.error("Script failed:", error);
        process.exit(1);
    }
}

main();
