# How to control which widget opens (and avoid loops)

## The problem
In this project, `_meta.ui.resourceUri` in `appPackage\ai-plugin.json` is not only used to associate a widget with a tool: the M365 host forces that resource to open or refresh as soon as the tool is called.

The main trap appears when a widget calls `app.callServerTool(...)` on a tool that itself has a `resourceUri`. The host then tries to reopen that resource widget, even if the call already came from a widget. That is how you create a reopen loop.

### Symptom
- the widget keeps reopening in a loop;
- a second instance of the widget appears;
- the user clicks **Back**, but the widget immediately reopens;
- a simple read call triggers an unwanted visual refresh.

## The solution
### The golden rule
Tools called **from a widget** via `callServerTool` must **never** have a `resourceUri`. Reserve `resourceUri` for tools called **by the LLM from the chat** to decide which widget should open.

### Pattern to apply in this project
- `listTickets` has `resourceUri: tickets-list.html`: the chat opens the ticket board.
- `getTicket` has **no** `resourceUri`: the widget uses it to read data without causing a reopen.
- `generateUIFromTicket` has **no** `resourceUri` on the host-routing side: let the widget detect the new UI through polling instead of forcing the preview to reopen.
- `generateUI` has `resourceUri: preview.html`: the chat directly opens the preview widget for standalone generation.

### Matrix of the 10 tools to maintain in `ai-plugin.json`

| Tool | `resourceUri` | Why |
| --- | --- | --- |
| `generateUI` | Yes → `ui://uigenerator/preview.html` | Standalone generation from the chat: the host must open the preview widget. |
| `updateUI` | Yes → `ui://uigenerator/preview.html` | Modifying a standalone UI from the chat: keep the preview as the main widget. |
| `listTickets` | Yes → `ui://uigenerator/tickets-list.html` | The chat opens the ticket board. |
| `getTicket` | No | Internal reads from a widget, state restoration, polling: no forced opening must happen. |
| `generateUIFromTicket` | No | The result is saved on the ticket, then detected by polling to avoid reopening `preview.html` in a loop. |
| `saveUIToTicket` | No | Technical save from the widget, with no widget change. |
| `createTicket` | Yes → `ui://uigenerator/tickets-list.html` | After creation from the chat, we want to show the updated board again. |
| `updateTicket` | Yes → `ui://uigenerator/tickets-list.html` | From the chat, the natural result is a refreshed board. If you call it from a widget, you accept a forced refresh. |
| `resetTickets` | Yes → `ui://uigenerator/tickets-list.html` | Reset must reopen a clean board immediately. |
| `viewTicketUI` | Yes → `ui://uigenerator/preview.html` | From the chat, we want to directly open the preview of an existing ticket. |

> Practical tip: keep this matrix consistent between `appPackage\ai-plugin.json` and the `_meta` declared in `mcp-server\src\mcp-server.ts`, otherwise the host behavior becomes hard to reason about.

### Pattern: use polling instead of `resourceUri`
For generation tools tied to a ticket, do not open the widget via `resourceUri`. Write the HTML on the server, then let the widget query `getTicket` every 5 seconds until `uiProposal` becomes available.

```javascript
const pollId = setInterval(async () => {
  const result = await app.callServerTool({
    name: 'getTicket',
    arguments: { ticketId }
  });

  const ticket = result?.structuredContent?.ticket || result?.structuredContent;
  if (ticket?.uiProposal) {
    clearInterval(pollId);
    await openPreview(ticketId);
  }
}, 5000);
```

## Examples
- In `tickets-list-widget.html`, `openPreview()` intentionally calls `getTicket` and not `viewTicketUI` to avoid the host trying to reopen `preview.html`.
- When the user clicks **Generate UI** in the board, the widget sends a message to the chat and then waits for `uiProposal` to become available through `getTicket`.
- If you replace that call with a tool that has a `resourceUri`, you recreate the classic bug: impossible back navigation, duplicate widget, or infinite reopen.

## Real implementation on the server side

### Resources registered with `registerAppResource`
Widgets are not abstractions: they are explicitly declared with a `ui://...` URI.

```typescript
const PREVIEW_URI = 'ui://uigenerator/preview.html';
const TICKETS_LIST_URI = 'ui://uigenerator/tickets-list.html';

registerAppResource(
  server,
  'UI Preview Widget',
  PREVIEW_URI,
  { description: 'Preview widget for generated interfaces' },
  async () => ({
    contents: [
      {
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
                'fonts.gstatic.com',
              ],
            },
          },
        },
      },
    ],
  }),
);

registerAppResource(
  server,
  'Tickets List Widget',
  TICKETS_LIST_URI,
  { description: 'Ticket management and UI proposal widget' },
  async () => ({
    contents: [
      {
        uri: TICKETS_LIST_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: ticketsListWidgetHtml,
        _meta: {
          ui: {
            csp: {
              resourceDomains: ['cdn.jsdelivr.net'],
            },
          },
        },
      },
    ],
  }),
);
```

### Tools with `resourceUri`: the host must open a widget
Real excerpts from `mcp-server\src\mcp-server.ts`:

```typescript
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
  async ({ description, htmlCode }) => {
    return {
      content: [{ type: 'text' as const, text: `Generated interface: ${description}` }],
      structuredContent: {
        type: 'generate',
        description,
        htmlCode,
        timestamp: new Date().toISOString(),
      },
    };
  },
);

registerAppTool(
  server,
  'listTickets',
  {
    description: 'List backlog tickets with their status, priority, and UI proposal availability',
    inputSchema: {},
    annotations: { readOnlyHint: true },
    _meta: {
      ui: { resourceUri: TICKETS_LIST_URI },
    },
  },
  async () => {
    const tickets = loadTickets();
    const summarizedTickets = summarizeTickets(tickets);
    return {
      content: [{ type: 'text' as const, text: `${summarizedTickets.length} tickets available.` }],
      structuredContent: {
        type: 'ticketList',
        tickets: summarizedTickets,
        total: summarizedTickets.length,
        timestamp: new Date().toISOString(),
      },
    };
  },
);

registerAppTool(
  server,
  'viewTicketUI',
  {
    description: 'Display a ticket UI proposal in the side preview panel',
    inputSchema: {
      ticketId: z.string().describe('Identifier of the ticket whose UI you want to view, for example US-001'),
    },
    annotations: { readOnlyHint: true },
    _meta: {
      ui: { resourceUri: PREVIEW_URI },
    },
  },
  async ({ ticketId }) => {
    const tickets = loadTickets();
    const { ticket } = findTicket(tickets, ticketId);
    const htmlCode = ticket.uiProposal || '<html><body><p>No UI available for this ticket.</p></body></html>';
    return {
      content: [{ type: 'text' as const, text: `UI for ticket ${ticketId} displayed.` }],
      structuredContent: {
        type: 'generate',
        ticketId,
        title: ticket.title,
        description: ticket.description,
        htmlCode,
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

The same pattern also exists on the server side for `updateUI`, `createTicket`, `updateTicket`, `resetTickets` and, in the current implementation, `generateUIFromTicket`.

### Tools without `resourceUri`: safe for `callServerTool()` from a widget
The real code shows two variants: explicit `_meta: {}` or absence of `resourceUri` on the plugin side.

```typescript
registerAppTool(
  server,
  'getTicket',
  {
    description: 'Retrieve the full details of a ticket, including the UI proposal if it exists',
    inputSchema: {
      ticketId: z.string().describe('Identifier of the ticket to inspect, for example US-001'),
    },
    annotations: { readOnlyHint: true },
    _meta: {},
  },
  async ({ ticketId }) => {
    const tickets = loadTickets();
    const { ticket } = findTicket(tickets, ticketId);
    return {
      content: [{ type: 'text' as const, text: `Ticket ${ticketId} loaded.` }],
      structuredContent: {
        type: 'ticketDetail',
        ticket,
        timestamp: new Date().toISOString(),
      },
    };
  },
);

registerAppTool(
  server,
  'saveUIToTicket',
  {
    description: 'Save or replace the HTML/CSS/JS UI proposal of an existing ticket',
    inputSchema: {
      ticketId: z.string().describe('Identifier of the ticket to update, for example US-001'),
      htmlCode: z.string().describe('Complete HTML/CSS/JS code to save as the UI proposal'),
    },
    _meta: {},
  },
  async ({ ticketId, htmlCode }) => {
    const tickets = loadTickets();
    const { ticket, index } = findTicket(tickets, ticketId);
    const updatedTicket: Ticket = { ...ticket, uiProposal: htmlCode || null };
    tickets[index] = updatedTicket;
    saveTickets(tickets);
    return {
      content: [{ type: 'text' as const, text: `UI proposal saved for ${ticketId}.` }],
      structuredContent: {
        type: 'ticketSave',
        saved: true,
        ticketId,
        ticket: updatedTicket,
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

### Double declaration in `ai-plugin.json`
On the plugin side, tools that open a widget are redeclared with two key forms:

```json
{
  "name": "generateUI",
  "_meta": {
    "ui": { "resourceUri": "ui://uigenerator/preview.html" },
    "ui/resourceUri": "ui://uigenerator/preview.html"
  }
}
```

The same is true for `listTickets`, `createTicket`, `updateTicket`, `resetTickets`, and `viewTicketUI`. This redundancy is not cosmetic: it serves the M365 host. When you change a URI, you must change it **in `mcp-server.ts` and in `appPackage\ai-plugin.json`**.

### Why `openPreview()` uses `getTicket`
The widget code literally explains it:

```javascript
async function openPreview(ticketId) {
  try {
    // Use getTicket (no resourceUri) to avoid the host trying to open preview.html
    const result = await app.callServerTool({ name: 'getTicket', arguments: { ticketId } });
    const data = result?.structuredContent;
    const ticket = data?.ticket || data;
    const htmlCode = ticket?.uiProposal;
    if (htmlCode) {
      state.previewTicketId = ticketId;
      state.previewHtml = htmlCode;
      state.previewTitle = ticket.title || ticketId;
      savePreviewState(ticketId);
      try {
        await app.updateModelContext({
          content: [{ type: 'text', text: `The user is viewing the UI for ticket ${ticketId} (${ticket.title || ''}). Here is the current HTML code for this UI:\n\n${htmlCode}\n\nIf the user requests modifications, use this code as the base and call generateUIFromTicket with the modified code.` }]
        });
      } catch (_) {}
      try { await app.requestDisplayMode({ mode: 'fullscreen' }); } catch (_) {}
      renderPreview();
    } else {
      setBanner(`No UI available for ${ticketId}.`, 'error');
    }
  } catch (e) {
    setBanner(`Error: ${e instanceof Error ? e.message : 'unable'}`, 'error');
  }
}
```

### The visible trap in the current code: calling a tool that itself opens a widget
The bug becomes clear by contrast with `viewTicketUI`:

```typescript
registerAppTool(
  server,
  'viewTicketUI',
  {
    description: 'Display a ticket UI proposal in the side preview panel',
    inputSchema: {
      ticketId: z.string().describe('Identifier of the ticket whose UI you want to view, for example US-001'),
    },
    annotations: { readOnlyHint: true },
    _meta: {
      ui: { resourceUri: PREVIEW_URI },
    },
  },
  async ({ ticketId }) => {
    // ...
  },
);
```

If a widget replaced its safe call:

```javascript
await app.callServerTool({ name: 'getTicket', arguments: { ticketId } });
```

with a call to `viewTicketUI`, the host would see `resourceUri: PREVIEW_URI` and try to reopen `preview.html`. That is exactly the kind of reopen loop this project avoids.

### Safe alternative actually used
The ticket widget always reads and polls with the same pattern:

```javascript
const result = await app.callServerTool({ name: 'getTicket', arguments: { ticketId } });
const data = result?.structuredContent;
const ticket = data?.ticket || data;
const htmlCode = ticket?.uiProposal;
```

To launch generation tied to a ticket, the widget does not do `callServerTool('generateUIFromTicket')`; it delegates routing to the chat, then polls `getTicket` again:

```javascript
const prompt = `Generate the UI for ticket ${ticketId}`;
await app.sendMessage({ role: 'user', content: [{ type: 'text', text: prompt }] });

const pollId = setInterval(async () => {
  const r = await app.callServerTool({ name: 'getTicket', arguments: { ticketId } });
  const t = r?.structuredContent?.ticket || r?.structuredContent;
  if (t?.uiProposal) {
    clearInterval(pollId);
    upsertTicketSummary(t);
    renderTickets();
    await openPreview(ticketId);
  }
}, 5000);
```

It is this `sendMessage()` + `getTicket` duo that avoids coupling a widget to a tool that would ask the host to open another widget again.
