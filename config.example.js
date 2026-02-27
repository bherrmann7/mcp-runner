// Copy this file to config.js and customize for your environment
export default {
  servers: {
    shell: {
      command: '/path/to/ShellMcpServer',
      args: []
    },
    oracle: {
      command: '/path/to/OracleMcpServer',
      args: []
    },
    jetbrains: {
      command: '/path/to/java',
      args: [
        '-classpath',
        '/path/to/mcpserver-frontend.jar:/path/to/util-8.jar',
        'com.intellij.mcpserver.stdio.McpStdioRunnerKt'
      ],
      env: {
        IJ_MCP_SERVER_PORT: '64342'
      }
    },
    'google-calendar': {
      command: '/path/to/GoogleCalendarMcpServer',
      args: []
    },
    gmail: {
      command: 'npx',
      args: ['@gongrzhe/server-gmail-autoauth-mcp']
    },
    atlassian: {
      command: '/path/to/start-atlassian',
      args: []
    }
  },
  jira: {
    assigneeName: 'Your Name',
    projectKey: 'PROJ',
    baseUrl: 'https://yoursite.atlassian.net',
    storyPointsField: 'customfield_10026'
  }
};
