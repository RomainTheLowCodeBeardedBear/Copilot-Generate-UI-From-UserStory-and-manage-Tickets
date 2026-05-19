# Skill : Agent déclaratif M365 + MCP Server - setup complet

> Référence adaptée pour **Copilot-Generate-UI-From-UserStory-and-manage-Tickets**. Cette skill documente le câblage complet entre un agent déclaratif M365 Copilot et le serveur MCP du projet UI Generator.

---

## Vue d'ensemble de l'architecture

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
      ▼ devtunnel (localhost -> HTTPS public)
M365 peut appeler le serveur
```

---

## 1. Structure du projet

```
Copilot-Generate-UI-From-UserStory-and-manage-Tickets/
├── appPackage/
│   ├── manifest.json              ← manifest M365 de l'agent
│   ├── uiGeneratorAgent.json      ← agent déclaratif (instructions + actions)
│   ├── ai-plugin.json             ← décrit les tools MCP et le runtime
│   ├── instruction.txt            ← instructions système de l'agent
│   └── color.png / outline.png
├── mcp-server/
│   ├── src/
│   │   ├── index.ts               ← serveur Express + CORS + routes /mcp
│   │   ├── mcp-server.ts          ← définition des tools MCP et widgets
│   │   └── config.ts
│   ├── assets/
│   │   ├── ui-preview-widget.html
│   │   └── tickets-list-widget.html
│   ├── data/
│   │   ├── tickets.json
│   │   └── tickets-default.json
│   ├── package.json
│   └── tsconfig.json
├── m365agents.local.yml           ← orchestration debug local + build MCP server
├── m365agents.yml                 ← provision / publish M365
└── env/
    ├── .env.local                 ← variables injectées par le toolkit
    └── .env.dev
```

---

## 2. `manifest.json` - points clés

Le manifest référence **l'agent déclaratif**, pas directement le plugin MCP.

```json
{
  "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.26/MicrosoftTeams.schema.json",
  "manifestVersion": "1.26",
  "id": "${{TEAMS_APP_ID}}",
  "version": "1.0.0",
  "name": {
    "short": "UI Generator${{APP_NAME_SUFFIX}}",
    "full": "Agent generateur d'interfaces HTML en temps reel"
  },
  "description": {
    "short": "Decrivez une interface, l'agent la genere en direct dans le chat.",
    "full": "Agent M365 Copilot qui genere des interfaces HTML/CSS/JS a la volee..."
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

**Points importants :**
- Le manifest ne référence **pas** `ai-plugin.json`.
- Le lien vers MCP se fait plus bas via `uiGeneratorAgent.json` -> `actions`.
- `${{TEAMS_APP_ID}}` est injecté automatiquement par le toolkit.
- Ici, le fichier déclaratif exact est **`uiGeneratorAgent.json`**.

---

## 3. `uiGeneratorAgent.json` - instructions de l'agent

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.6/schema.json",
  "version": "v1.6",
  "name": "UI Generator${{APP_NAME_SUFFIX}}",
  "description": "Agent qui genere des interfaces HTML/CSS/JS a la volee.",
  "instructions": "$[file('instruction.txt')]",
  "conversation_starters": [
    {
      "title": "Formulaire de contact",
      "text": "Genere un formulaire de contact avec nom, email, message et un bouton envoyer"
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

**Points importants :**
- `instructions` peut être inline, mais un fichier `.txt` reste préférable pour des consignes longues.
- `actions` est **le point de liaison** vers `ai-plugin.json`.
- `version: v1.6` est la version du schéma d'agent déclaratif, **pas** celle du manifest Teams.

---

## 4. `ai-plugin.json` - connexion MCP

### ⚠️ `description_for_model` = LE CHAMP LE PLUS CRITIQUE

C'est **le champ le plus important de tout le plugin**.

C'est lui qui explique au LLM **comment router la demande vers le bon tool** :
- `generateUI` / `updateUI` pour une UI libre sans ticket
- `listTickets` / `getTicket` pour consulter le backlog
- `generateUIFromTicket` pour générer une UI à partir d'un ticket
- `createTicket` pour créer un ticket et éventuellement y sauvegarder le HTML final
- `saveUIToTicket`, `updateTicket`, `resetTickets`, `viewTicketUI` pour les actions de gestion

Dans ce projet, `description_for_model` doit impérativement couvrir **les 3 cas d'usage** :
1. **UI depuis un ticket existant** -> utiliser `generateUIFromTicket`
2. **Créer un ticket puis générer son UI** -> `createTicket`, puis `generateUIFromTicket`
3. **UI libre sans ticket** -> `generateUI`, puis `updateUI` pour les itérations

Et surtout : si l'utilisateur demande ensuite de sauvegarder cette UI libre dans un ticket, il faut appeler `createTicket` avec **le dernier `htmlCode` complet** de la conversation.

### Structure cible

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json",
  "schema_version": "v2.4",
  "namespace": "uigenerator",
  "name_for_human": "UI Generator${{APP_NAME_SUFFIX}}",
  "description_for_human": "Genere des interfaces HTML/CSS/JS a la volee dans le chat M365 Copilot et gere des tickets UI.",
  "description_for_model": "Plugin de gestion de tickets UI et generation d'interfaces web... TROIS CAS D'USAGE...",
  "functions": [
    { "name": "generateUI", "description": "Genere une interface HTML/CSS/JS complete a partir d'une description libre." },
    { "name": "updateUI", "description": "Modifie l'interface existante affichee dans le panneau lateral." },
    { "name": "listTickets", "description": "Liste les tickets du backlog UI." },
    { "name": "getTicket", "description": "Recupere le detail complet d'un ticket." },
    { "name": "generateUIFromTicket", "description": "Genere ou modifie une interface a partir d'un ticket." },
    { "name": "saveUIToTicket", "description": "Enregistre la version finale d'une interface sur un ticket existant." },
    { "name": "createTicket", "description": "Cree un ticket. Peut inclure htmlCode." },
    { "name": "updateTicket", "description": "Met a jour les champs d'un ticket." },
    { "name": "resetTickets", "description": "Reinitialise le backlog de demo." },
    { "name": "viewTicketUI", "description": "Affiche la proposition UI d'un ticket dans le preview panel." }
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

### Points critiques
- `schema_version` = **`v2.4`**
- `namespace` = **`uigenerator`**
- `type` = **`RemoteMCPServer`**
- URL runtime = **`${{OPENAPI_SERVER_URL}}/mcp`**
- chaque tool doit exposer un `inputSchema` JSON Schema valide
- chaque tool doit inclure `"execution": { "taskSupport": "forbidden" }`
- pour un widget, ajouter `"_meta": { "ui": { "resourceUri": "ui://..." } }`

### Exemples de tools réels

#### Tool de preview UI
```json
{
  "name": "generateUI",
  "description": "Genere une interface HTML/CSS/JS complete a partir d'une description libre (sans ticket).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "description": {
        "type": "string",
        "description": "Description en langage naturel de l'interface a generer"
      },
      "htmlCode": {
        "type": "string",
        "description": "Code HTML/CSS/JS complet de l'interface generee. Document HTML valide auto-contenu."
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

#### Tool backlog tickets
```json
{
  "name": "listTickets",
  "description": "Liste tous les tickets UI disponibles sans inclure le contenu HTML des propositions UI.",
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

#### Tool ticket -> UI
```json
{
  "name": "generateUIFromTicket",
  "description": "Genere une interface HTML/CSS/JS a partir de la description d'un ticket et enregistre la proposition UI sur ce ticket.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "ticketId": {
        "type": "string",
        "description": "Identifiant du ticket source (ex: 'US-001')"
      },
      "htmlCode": {
        "type": "string",
        "description": "Code HTML/CSS/JS complet genere a partir de la description du ticket."
      }
    },
    "required": ["ticketId", "htmlCode"],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "execution": { "taskSupport": "forbidden" }
}
```

#### Tool création de ticket avec sauvegarde d'UI
```json
{
  "name": "createTicket",
  "description": "Cree un nouveau ticket. Si htmlCode est fourni, enregistre aussi la proposition UI directement.",
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
        "description": "Inclure le dernier HTML genere/modifie dans la conversation"
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

### Règle d'or

Si le routage des tools est mauvais, le problème vient presque toujours de `description_for_model` avant toute autre chose.

---

## 5. `m365agents.local.yml` - orchestration debug local

Ce fichier est exécuté lors d'un **F5 / debug local**.

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

**En pratique :**
1. le toolkit provisionne l'application M365
2. zip + valide + met à jour l'app package
3. crée le devtunnel
4. injecte `OPENAPI_SERVER_URL`
5. build puis démarre le serveur MCP
6. ouvre Copilot avec l'agent chargé

---

## 6. Variables d'environnement

```bash
# Variables gérées par le toolkit
TEAMSFX_ENV=local
APP_NAME_SUFFIX=local
TEAMS_APP_ID=<auto-genere>
M365_TITLE_ID=<auto-genere>
M365_APP_ID=<auto-genere>

# URL du devtunnel injectée à chaque session
OPENAPI_SERVER_URL=https://xxxxxxxx-xxxx.devtunnels.ms
```

**Important :**
- `OPENAPI_SERVER_URL` change régulièrement.
- Ne pas la hardcoder dans `ai-plugin.json`.
- Toujours garder `${{OPENAPI_SERVER_URL}}/mcp`.

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

### ⚠️ Pièges CORS
- `origin === 'null'` doit être autorisé : les iframes M365 sandboxées l'envoient souvent littéralement.
- ne pas oublier `app.options('*', cors())`
- inclure les headers MCP custom dans `allowedHeaders`
- autoriser aussi `widgetcopilot.net` et `usercontent.microsoft.com` pour les cas d'hébergement M365

### Pattern stateless MCP
Le serveur crée **un nouveau `McpServer` et un nouveau transport par requête** :

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

Le projet expose aussi `GET /mcp`, `DELETE /mcp` et `GET /health`.

---

## 8. `mcp-server.ts` - définir les tools et widgets

### Ressources UI du projet
```ts
const PREVIEW_URI = 'ui://uigenerator/preview.html';
const TICKETS_LIST_URI = 'ui://uigenerator/tickets-list.html';
```

### Widgets enregistrés
```ts
registerAppResource(server, 'UI Preview Widget', PREVIEW_URI, ...)
registerAppResource(server, 'Tickets List Widget', TICKETS_LIST_URI, ...)
```

### Exemple : resource de preview
```ts
registerAppResource(
  server,
  'UI Preview Widget',
  PREVIEW_URI,
  { description: 'Widget de previsualisation des interfaces generees' },
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

### Exemple : tool avec widget de preview
```ts
registerAppTool(
  server,
  'generateUI',
  {
    description: 'Genere une interface HTML/CSS/JS complete a partir d\'une description',
    inputSchema: {
      description: z.string().describe('Description de l\'interface generee'),
      htmlCode: z.string().describe('Code HTML/CSS/JS complet auto-contenu'),
    },
    _meta: { ui: { resourceUri: PREVIEW_URI } },
  },
  async ({ description, htmlCode }) => ({
    content: [{ type: 'text', text: `Interface generee: ${description}` }],
    structuredContent: {
      type: 'generate',
      description,
      htmlCode,
      timestamp: new Date().toISOString(),
    },
  })
);
```

### Exemple : tool backlog avec widget liste
```ts
registerAppTool(
  server,
  'listTickets',
  {
    description: 'Liste les tickets du backlog avec leur statut, priorite et disponibilite d\'une proposition UI',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: TICKETS_LIST_URI } },
  },
  async () => ({
    content: [{ type: 'text', text: '3 tickets disponibles.' }],
    structuredContent: {
      type: 'ticketList',
      tickets: summarizedTickets,
      total: summarizedTickets.length,
      timestamp: new Date().toISOString(),
    },
  })
);
```

### Tools réellement exposés par le serveur
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

**Notes :**
- `type: module` est requis
- `tsx` est utilisé pour le mode dev
- le serveur est compilé par `tsc`

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

`module: NodeNext` + `moduleResolution: NodeNext` sont essentiels pour les imports ESM avec extensions `.js` depuis TypeScript.

---

## 11. Checklist de câblage

1. `manifest.json` pointe vers `uiGeneratorAgent.json`
2. `uiGeneratorAgent.json` pointe vers `ai-plugin.json`
3. `ai-plugin.json` utilise `namespace: uigenerator`
4. `ai-plugin.json` utilise `type: RemoteMCPServer`
5. l'URL runtime est `${{OPENAPI_SERVER_URL}}/mcp`
6. `description_for_model` décrit clairement les **3 cas d'usage**
7. les tools widgetés déclarent `_meta.ui.resourceUri`
8. les widgets sont enregistrés via `registerAppResource`
9. CORS autorise `null` + domaines Microsoft + devtunnel
10. après changement du serveur ou des ressources : rebuild puis relancer

---

## À retenir

Sur ce projet, le setup fonctionne si le trio suivant est correct :
- **manifest -> uiGeneratorAgent.json**
- **uiGeneratorAgent.json -> ai-plugin.json**
- **ai-plugin.json -> RemoteMCPServer -> `${{OPENAPI_SERVER_URL}}/mcp`**

Mais le vrai point décisif reste **`description_for_model`** : c'est elle qui dicte au LLM quand utiliser `generateUI`, `updateUI`, `createTicket` ou `generateUIFromTicket`.