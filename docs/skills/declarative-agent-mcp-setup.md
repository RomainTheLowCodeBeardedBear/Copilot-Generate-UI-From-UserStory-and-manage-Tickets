# Skill: M365 Declarative Agent + MCP Server - complete setup

> Reference adapted for **Copilot-Generate-UI-From-UserStory-and-manage-Tickets**. This skill documents the complete wiring between an M365 Copilot declarative agent and the MCP server in the UI Generator project.

---

## Architecture overview

```
M365 Copilot Chat
      │
      │ (invoke tool via manifest)
      ▼
Declarative Agent (appPackage/)
      │
      │ MCP Protocol HTTP POST /mcp
      ▼
MCP Server Express (mcp-server/)
      │
      ▼ devtunnel (localhost -> public HTTPS)
M365 can call the server
```

---

## 1. Project structure

```
Copilot-Generate-UI-From-UserStory-and-manage-Tickets/
├── appPackage/
│   ├── manifest.json              ← agent M365 manifest
│   ├── uiGeneratorAgent.json      ← declarative agent (instructions + actions)
│   ├── ai-plugin.json             ← describes MCP tools and the runtime
│   ├── instruction.txt            ← agent system instructions
│   └── color.png / outline.png
├── mcp-server/
│   ├── src/
│   │   ├── index.ts               ← Express server + CORS + /mcp routes
│   │   ├── mcp-server.ts          ← MCP tools and widget definitions
│   │   └── config.ts
│   ├── assets/
│   │   ├── ui-preview-widget.html
│   │   └── tickets-list-widget.html
│   ├── data/
│   │   ├── tickets.json
│   │   └── tickets-default.json
│   ├── package.json
│   └── tsconfig.json
├── m365agents.local.yml           ← local debug orchestration + MCP server build
├── m365agents.yml                 ← M365 provision / publish
└── env/
    ├── .env.local                 ← variables injected by the toolkit
    └── .env.dev
```

---

## 2. `manifest.json` - key points

The manifest references the **declarative agent**, not the MCP plugin directly.

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.26/MicrosoftTeams.schema.json",
  "manifestVersion": "1.26",
  "id": "${{TEAMS_APP_ID}}",
  "version": "1.0.0",
  "name": {
    "short": "UI Generator${{APP_NAME_SUFFIX}}",
    "full": "Real-time HTML interface generator agent"
  },
  "description": {
    "short": "Describe an interface and the agent generates it live in the chat.",
    "full": "M365 Copilot agent that generates HTML/CSS/JS interfaces on the fly..."
  },
  "copilotAgents": {
    "declarativeAgents": [
      {
        "id": "uiGeneratorAgent",
        "file": "uiGeneratorAgent.json"
      }
    ]
  },
  "permissions": ["identity", "messageTeamMembers"]
}
```

**Important points:**
- The manifest does **not** reference `ai-plugin.json`.
- The MCP link is made lower down through `uiGeneratorAgent.json` -> `actions`.
- `${{TEAMS_APP_ID}}` is automatically injected by the toolkit.
- Here, the exact declarative file is **`uiGeneratorAgent.json`**.

---

## 3. `uiGeneratorAgent.json` - agent instructions

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.6/schema.json",
  "version": "v1.6",
  "name": "UI Generator${{APP_NAME_SUFFIX}}",
  "description": "Agent that generates HTML/CSS/JS interfaces on the fly.",
  "instructions": "$[file('instruction.txt')]",
  "conversation_starters": [
    {
      "title": "Contact form",
      "text": "Generate a contact form with name, email, message, and a send button"
    }
  ],
  "actions": [
    {
      "id": "uiGeneratorPlugin",
      "file": "ai-plugin.json"
    }
  ]
}
```

**Important points:**
- `instructions` can be inline, but a `.txt` file is still preferable for long instructions.
- `actions` is **the link point** to `ai-plugin.json`.
- `version: v1.6` is the declarative agent schema version, **not** the Teams manifest version.

---

## 4. `ai-plugin.json` - MCP connection

### ⚠️ `description_for_model` = THE MOST CRITICAL FIELD

It is **the most important field in the entire plugin**.

It is what tells the LLM **how to route the request to the right tool**:
- `generateUI` / `updateUI` for a standalone UI without a ticket
- `listTickets` / `getTicket` to browse the backlog
- `generateUIFromTicket` to generate a UI from a ticket
- `createTicket` to create a ticket and optionally save the final HTML into it
- `saveUIToTicket`, `updateTicket`, `resetTickets`, `viewTicketUI` for management actions

In this project, `description_for_model` must explicitly cover **the 3 use cases**:
1. **UI from an existing ticket** -> use `generateUIFromTicket`
2. **Create a ticket then generate its UI** -> `createTicket`, then `generateUIFromTicket`
3. **Standalone UI without a ticket** -> `generateUI`, then `updateUI` for iterations

And most importantly: if the user later asks to save that standalone UI into a ticket, you must call `createTicket` with **the latest full `htmlCode`** from the conversation.

### Target structure

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json",
  "schema_version": "v2.4",
  "namespace": "uigenerator",
  "name_for_human": "UI Generator${{APP_NAME_SUFFIX}}",
  "description_for_human": "Generate HTML/CSS/JS interfaces on the fly in M365 Copilot chat and manage UI tickets.",
  "description_for_model": "UI ticket management and web interface generation plugin... THREE USE CASES...",
  "functions": [
    { "name": "generateUI", "description": "Generate a complete HTML/CSS/JS interface from a standalone description." },
    { "name": "updateUI", "description": "Modify the existing interface shown in the side panel." },
    { "name": "listTickets", "description": "List UI backlog tickets." },
    { "name": "getTicket", "description": "Retrieve the full details of a ticket." },
    { "name": "generateUIFromTicket", "description": "Generate or modify an interface from a ticket." },
    { "name": "saveUIToTicket", "description": "Save the final version of an interface to an existing ticket." },
    { "name": "createTicket", "description": "Create a ticket. Can include htmlCode." },
    { "name": "updateTicket", "description": "Update ticket fields." },
    { "name": "resetTickets", "description": "Reset the demo backlog." },
    { "name": "viewTicketUI", "description": "Display a ticket's UI proposal in the preview panel." }
  ],
  "runtimes": [
    {
      "type": "RemoteMCPServer",
      "spec": {
        "url": "${{OPENAPI_SERVER_URL}}/mcp",
        "x-mcp_tool_description": {
          "tools": []
        }
      },
      "run_for_functions": [
        "generateUI",
        "updateUI",
        "listTickets",
        "getTicket",
        "createTicket",
        "generateUIFromTicket",
        "saveUIToTicket",
        "updateTicket",
        "resetTickets",
        "viewTicketUI"
      ]
    }
  ]
}
```

### Critical points
- `schema_version` = **`v2.4`**
- `namespace` = **`uigenerator`**
- `type` = **`RemoteMCPServer`**
- runtime URL = **`${{OPENAPI_SERVER_URL}}/mcp`**
- each tool must expose a valid JSON Schema `inputSchema`
- each tool must include `"execution": { "taskSupport": "forbidden" }`
- for a widget, add `"_meta": { "ui": { "resourceUri": "ui://..." } }`

### Real tool examples

#### UI preview tool
```json
{
  "name": "generateUI",
  "description": "Generate a complete HTML/CSS/JS interface from a standalone description (without a ticket).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "description": {
        "type": "string",
        "description": "Natural-language description of the interface to generate"
      },
      "htmlCode": {
        "type": "string",
        "description": "Complete HTML/CSS/JS code for the generated interface. Self-contained valid HTML document."
      }
    },
    "required": ["description", "htmlCode"],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "execution": { "taskSupport": "forbidden" },
  "_meta": {
    "ui": { "resourceUri": "ui://uigenerator/preview.html" },
    "ui/resourceUri": "ui://uigenerator/preview.html"
  }
}
```

#### Ticket backlog tool
```json
{
  "name": "listTickets",
  "description": "List all available UI tickets without including the HTML content of UI proposals.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "execution": { "taskSupport": "forbidden" },
  "annotations": { "readOnlyHint": true },
  "_meta": {
    "ui": { "resourceUri": "ui://uigenerator/tickets-list.html" },
    "ui/resourceUri": "ui://uigenerator/tickets-list.html"
  }
}
```

#### Ticket -> UI tool
```json
{
  "name": "generateUIFromTicket",
  "description": "Generate an HTML/CSS/JS interface from a ticket description and save the UI proposal on that ticket.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "ticketId": {
        "type": "string",
        "description": "Source ticket identifier (example: 'US-001')"
      },
      "htmlCode": {
        "type": "string",
        "description": "Complete HTML/CSS/JS code generated from the ticket description."
      }
    },
    "required": ["ticketId", "htmlCode"],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "execution": { "taskSupport": "forbidden" }
}
```

#### Ticket creation tool with UI save
```json
{
  "name": "createTicket",
  "description": "Create a new ticket. If htmlCode is provided, also save the UI proposal directly.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "description": { "type": "string" },
      "priority": {
        "type": "string",
        "enum": ["High", "Medium", "Low"]
      },
      "assignee": { "type": "string" },
      "htmlCode": {
        "type": "string",
        "description": "Include the latest HTML generated/modified in the conversation"
      }
    },
    "required": ["title", "description"],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "execution": { "taskSupport": "forbidden" },
  "_meta": {
    "ui": { "resourceUri": "ui://uigenerator/tickets-list.html" },
    "ui/resourceUri": "ui://uigenerator/tickets-list.html"
  }
}
```

### Golden rule

If tool routing is wrong, the problem almost always comes from `description_for_model` before anything else.

---

## 5. `m365agents.local.yml` - local debug orchestration

This file runs during **F5 / local debug**.

```yaml
# yaml-language-server: $schema=https://aka.ms/m365-agents-toolkits/v1.11/yaml.schema.json
version: v1.11

provision:
  - uses: teamsApp/create
    with:
      name: UIGeneratorAgent${{APP_NAME_SUFFIX}}
    writeToEnvironmentFile:
      teamsAppId: TEAMS_APP_ID

  - uses: teamsApp/zipAppPackage
    with:
      manifestPath: ./appPackage/manifest.json
      outputZipPath: ./appPackage/build/appPackage.${{TEAMSFX_ENV}}.zip
      outputFolder: ./appPackage/build

  - uses: teamsApp/validateAppPackage
    with:
      appPackagePath: ./appPackage/build/appPackage.${{TEAMSFX_ENV}}.zip

  - uses: teamsApp/update
    with:
      appPackagePath: ./appPackage/build/appPackage.${{TEAMSFX_ENV}}.zip

  - uses: teamsApp/extendToM365
    with:
      appPackagePath: ./appPackage/build/appPackage.${{TEAMSFX_ENV}}.zip
    writeToEnvironmentFile:
      titleId: M365_TITLE_ID
      appId: M365_APP_ID

deploy:
  - uses: cli/runNpmCommand
    name: install mcp-server dependencies
    with:
      args: install
      workingDirectory: ./mcp-server

  - uses: cli/runNpmCommand
    name: build mcp-server
    with:
      args: run build
      workingDirectory: ./mcp-server
```

**In practice:**
1. the toolkit provisions the M365 application
2. zips + validates + updates the app package
3. creates the devtunnel
4. injects `OPENAPI_SERVER_URL`
5. builds then starts the MCP server
6. opens Copilot with the loaded agent

---

## 6. Environment variables

```bash
# Variables managed by the toolkit
TEAMSFX_ENV=local
APP_NAME_SUFFIX=local
TEAMS_APP_ID=<auto-generated>
M365_TITLE_ID=<auto-generated>
M365_APP_ID=<auto-generated>

# Devtunnel URL injected for each session
OPENAPI_SERVER_URL=https://xxxxxxxx-xxxx.devtunnels.ms
```

**Important:**
- `OPENAPI_SERVER_URL` changes regularly.
- Do not hardcode it in `ai-plugin.json`.
- Always keep `${{OPENAPI_SERVER_URL}}/mcp`.

---

## 7. MCP Server Express (`mcp-server/src/index.ts`)

```ts
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

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin === 'null' || ALLOWED_ORIGINS.some((re) => re.test(origin))) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Accept',
    'Mcp-Session-Id',
    'mcp-session-id',
    'Last-Event-ID',
    'Mcp-Protocol-Version',
    'mcp-protocol-version'
  ],
  exposedHeaders: ['Mcp-Session-Id'],
}));
app.options('*', cors());
```

### ⚠️ CORS pitfalls
- `origin === 'null'` must be allowed: sandboxed M365 iframes often send it literally.
- do not forget `app.options('*', cors())`
- include custom MCP headers in `allowedHeaders`
- also allow `widgetcopilot.net` and `usercontent.microsoft.com` for M365 hosting cases

### Stateless MCP pattern
The server creates **a new `McpServer` and a new transport per request**:

```ts
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
```

The project also exposes `GET /mcp`, `DELETE /mcp`, and `GET /health`.

---

## 8. `mcp-server.ts` - define tools and widgets

### Project UI resources
```ts
const PREVIEW_URI = 'ui://uigenerator/preview.html';
const TICKETS_LIST_URI = 'ui://uigenerator/tickets-list.html';
```

### Registered widgets
```ts
registerAppResource(server, 'UI Preview Widget', PREVIEW_URI, ...)
registerAppResource(server, 'Tickets List Widget', TICKETS_LIST_URI, ...)
```

### Example: preview resource
```ts
registerAppResource(
  server,
  'UI Preview Widget',
  PREVIEW_URI,
  { description: 'Preview widget for generated interfaces' },
  async () => ({
    contents: [{
      uri: PREVIEW_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: previewWidgetHtml,
      _meta: {
        ui: {
          csp: {
            resourceDomains: [
              'unpkg.com',
              'cdn.jsdelivr.net',
              'fonts.googleapis.com',
              'fonts.gstatic.com'
            ]
          }
        }
      }
    }]
  })
);
```

### Example: tool with preview widget
```ts
registerAppTool(
  server,
  'generateUI',
  {
    description: 'Generate a complete HTML/CSS/JS interface from a description',
    inputSchema: {
      description: z.string().describe('Description of the generated interface'),
      htmlCode: z.string().describe('Complete self-contained HTML/CSS/JS code'),
    },
    _meta: { ui: { resourceUri: PREVIEW_URI } },
  },
  async ({ description, htmlCode }) => ({
    content: [{ type: 'text', text: `Generated interface: ${description}` }],
    structuredContent: {
      type: 'generate',
      description,
      htmlCode,
      timestamp: new Date().toISOString(),
    },
  })
);
```

### Example: backlog tool with list widget
```ts
registerAppTool(
  server,
  'listTickets',
  {
    description: 'List backlog tickets with their status, priority, and availability of a UI proposal',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: TICKETS_LIST_URI } },
  },
  async () => ({
    content: [{ type: 'text', text: '3 tickets available.' }],
    structuredContent: {
      type: 'ticketList',
      tickets: summarizedTickets,
      total: summarizedTickets.length,
      timestamp: new Date().toISOString(),
    },
  })
);
```

### Tools actually exposed by the server
- `generateUI`
- `updateUI`
- `listTickets`
- `getTicket`
- `viewTicketUI`
- `generateUIFromTicket`
- `saveUIToTicket`
- `createTicket`
- `updateTicket`
- `resetTickets`

---

## 9. `mcp-server/package.json`

```json
{
  "name": "ui-generator-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node --env-file=.env dist/index.js",
    "dev": "node --env-file=.env --import tsx --watch src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/ext-apps": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "cors": "^2.8.5",
    "express": "^4.21.0",
    "zod": "^3.25.0"
  }
}
```

**Notes:**
- `type: module` is required
- `tsx` is used for dev mode
- the server is compiled by `tsc`

---

## 10. `mcp-server/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

`module: NodeNext` + `moduleResolution: NodeNext` are essential for ESM imports with `.js` extensions from TypeScript.

---

## 11. Wiring checklist

1. `manifest.json` points to `uiGeneratorAgent.json`
2. `uiGeneratorAgent.json` points to `ai-plugin.json`
3. `ai-plugin.json` uses `namespace: uigenerator`
4. `ai-plugin.json` uses `type: RemoteMCPServer`
5. the runtime URL is `${{OPENAPI_SERVER_URL}}/mcp`
6. `description_for_model` clearly describes the **3 use cases**
7. widget-enabled tools declare `_meta.ui.resourceUri`
8. widgets are registered through `registerAppResource`
9. CORS allows `null` + Microsoft domains + devtunnel
10. after changing the server or resources: rebuild then relaunch

---

## Key takeaway

In this project, the setup works if the following trio is correct:
- **manifest -> uiGeneratorAgent.json**
- **uiGeneratorAgent.json -> ai-plugin.json**
- **ai-plugin.json -> RemoteMCPServer -> `${{OPENAPI_SERVER_URL}}/mcp`**

But the real deciding factor is still **`description_for_model`**: it is what tells the LLM when to use `generateUI`, `updateUI`, `createTicket`, or `generateUIFromTicket`.
