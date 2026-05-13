import express from 'express';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp-server.js';
import { PORT } from './config.js';

const app = express();
app.use(express.json({ limit: '5mb' }));

const ALLOWED_ORIGINS = [
  /https:\/\/.*\.widgetcopilot\.net$/,
  /https:\/\/.*\.microsoft\.com$/,
  /https:\/\/.*\.cloud\.microsoft$/,
  /https:\/\/.*\.office\.com$/,
  /https:\/\/.*\.usercontent\.microsoft\.com$/,
  /https:\/\/.*\.devtunnels\.ms$/,
  /http:\/\/localhost:\d+$/,
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || origin === 'null' || ALLOWED_ORIGINS.some((re) => re.test(origin))) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Mcp-Session-Id', 'mcp-session-id', 'Last-Event-ID', 'Mcp-Protocol-Version', 'mcp-protocol-version'],
    exposedHeaders: ['Mcp-Session-Id'],
  }),
);
app.options('*', cors());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ui-generator-mcp-server' });
});

// Stateless MCP: fresh server + transport per request
app.post('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on('finish', () => server.close());
});

app.get('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
  res.on('finish', () => server.close());
});

app.delete('/mcp', async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
  res.on('finish', () => server.close());
});

app.listen(PORT, () => {
  console.log(`UI Generator MCP Server running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
