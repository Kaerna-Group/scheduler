import {
  serveStdio,
  StdioServerTransport,
} from '@modelcontextprotocol/server/stdio';
import { createSchedulerMcpServer } from './server.ts';

if (process.argv.length > 2) {
  process.stderr.write(
    'Scheduler MCP uses stdio and environment variables; command-line arguments are not supported.\n',
  );
  process.exitCode = 1;
} else {
  const reportError = () =>
    process.stderr.write(
      'Scheduler MCP transport error. No request or credential was logged.\n',
    );
  const handle = serveStdio(() => createSchedulerMcpServer(process.env), {
    transport: new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: 1024 * 1024,
    }),
    onerror: reportError,
  });
  const close = () => {
    void handle.close().catch(reportError);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  process.stdin.once('end', close);
}
