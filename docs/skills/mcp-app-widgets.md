# Skill: MCP App Widgets - patterns and pitfalls

> Reference adapted for the **UI Generator project**. This skill documents the right patterns for building HTML widgets used by the project's MCP tools.

---

## Principle

An MCP App widget is a standalone HTML file rendered inside a sandboxed iframe in M365 Copilot. It receives tool data through `App` and then updates its DOM.

```
Tool result (structuredContent)
        │
        ▼
  App.ontoolresult(result)
        │
        ▼
  render(result.structuredContent)
        │
        ▼
  root.innerHTML = generateHtml(data)
```

In this project, the two main widgets are:
- `mcp-server/assets/tickets-list-widget.html`
- `mcp-server/assets/ui-preview-widget.html`

---

## 1. Base HTML template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- External libs BEFORE the module if they expose globals -->
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"></script>

  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--fontFamilyBase, 'Segoe UI', sans-serif);
    }
  </style>
  <!-- ⚠️ </style> REQUIRED -->
</head>
<body>
  <div id="root"></div>

  <script type="module">
    import { App } from 'https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps/+esm';
    import { webLightTheme, webDarkTheme } from 'https://cdn.jsdelivr.net/npm/@fluentui/tokens/+esm';

    const root = document.getElementById('root');
    const app = new App({ name: 'ui-preview', version: '1.0.0' });

    function applyTheme(theme) {
      const tokens = theme === 'dark' ? webDarkTheme : webLightTheme;
      for (const [k, v] of Object.entries(tokens)) {
        document.documentElement.style.setProperty('--' + k, v);
      }
    }

    function render(data) {
      root.innerHTML = `<div>${data.title}</div>`;
    }

    app.ontoolresult = (result) => {
      const data = result.structuredContent;
      if (data) render(data);
    };

    app.onhostcontextchanged = (ctx) => {
      if (ctx.theme) applyTheme(ctx.theme);
    };

    app.onteardown = () => ({});

    await app.connect();
    const ctx = app.getHostContext();
    if (ctx?.theme) applyTheme(ctx.theme);
  </script>
</body>
</html>
```

---

## 2. ⚠️ Critical pitfall: missing `</style>` tag

**Symptom**: empty widget, gray panel, no visible DOM.

**Cause**: if `</style>` is missing, everything that follows is interpreted as CSS.

**Rule**: every time you modify a `<style>` block, verify that the final `</style>` is present.

```html
<!-- ✅ correct -->
<style>
  .card { padding: 12px; }
</style>

<!-- ❌ broken -->
<style>
  .card { padding: 12px; }
<div>this div will never be created</div>
```

This is a classic trap in AI-edited HTML widgets.

---

## 3. `registerAppTool` vs `registerTool`

| | `server.registerTool` | `registerAppTool` |
|---|---|---|
| Import | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/ext-apps/server` |
| HTML widget | ❌ No | ✅ Yes |
| Usage | Pure text tool | Tool with visual rendering |

### Tool without a widget

```ts
server.registerTool('getTicket', {
  description: 'Retrieve the full details of a ticket',
  inputSchema: { ticketId: z.string() },
}, async ({ ticketId }) => ({
  content: [{ type: 'text', text: `Ticket ${ticketId} loaded.` }],
  structuredContent: { ticketId }
}));
```

### Tool with a widget

```ts
registerAppTool(
  server,
  'listTickets',
  {
    description: 'List UI backlog tickets',
    inputSchema: {},
    _meta: { ui: { resourceUri: 'ui://uigenerator/tickets-list.html' } }
  },
  async () => ({
    content: [{ type: 'text', text: 'Tickets loaded.' }],
    structuredContent: {
      type: 'ticketList',
      tickets,
      total: tickets.length,
    }
  })
);
```

### Widget resource

```ts
registerAppResource(
  server,
  'UI Preview Widget',
  'ui://uigenerator/preview.html',
  { description: 'UI preview widget' },
  async () => ({
    contents: [{
      uri: 'ui://uigenerator/preview.html',
      mimeType: RESOURCE_MIME_TYPE,
      text: previewWidgetHtml,
      _meta: {
        ui: {
          csp: {
            resourceDomains: ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']
          }
        }
      }
    }]
  })
);
```

---

## 4. State + re-render pattern without a framework

An MCP App widget often goes through several states: loading, error, success, editing.

```js
let currentData = null;
let isLoading = false;
let lastError = null;

function renderScreen() {
  if (isLoading) {
    root.innerHTML = `<div>Loading...</div>`;
    return;
  }

  if (lastError) {
    root.innerHTML = `<div style="color:red">${escapeHtml(lastError)}</div>`;
    return;
  }

  root.innerHTML = buildHtml(currentData);

  // ⚠️ Re-attach listeners after every innerHTML
  root.querySelector('[data-action="refresh"]')?.addEventListener('click', handleRefresh);
}
```

In this project:
- `ui-preview-widget.html` handles `loading`, `preview`, `code view`, `error`
- `tickets-list-widget.html` handles `loading`, `list`, `banner`, `preview`, `edit form`

---

## 5. Event delegation - a robust alternative

When the DOM is regenerated often, event delegation is more robust than re-attaching all listeners after each `innerHTML`.

```js
root.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const ticketId = button.dataset.ticketId;

  if (action === 'view') openPreview(ticketId);
  if (action === 'generate') generateFromTicket(ticketId);
  if (action === 'delete') deleteUi(ticketId);
});
```

The project's tickets widget attaches its listeners after rendering, but this delegation pattern remains useful as soon as the widget becomes more complex.

---

## 6. `structuredContent` - what the widget actually receives

**Absolute rule:** application data lives in **`result.structuredContent`**.

```js
app.ontoolresult = (result) => {
  const data = result.structuredContent;
  if (!data) return;
  render(data);
};
```

**Do not do this:**
```js
result.data      // ❌ undefined
result.content   // ❌ text summary for the LLM, not your business data
result           // ❌ raw MCP object
```

### Project examples

#### Result of `listTickets`
```js
{
  type: 'ticketList',
  tickets: [...],
  total: 3,
  timestamp: '...'
}
```

#### Result of `generateUI` / `updateUI`
```js
{
  type: 'generate',
  description: 'Modern landing page',
  htmlCode: '<!DOCTYPE html>...',
  timestamp: '...'
}
```

#### Result of `generateUIFromTicket`
```js
{
  type: 'generate',
  ticketId: 'US-001',
  title: 'Dashboard home',
  description: '...',
  htmlCode: '<!DOCTYPE html>...',
  ticket: { ... },
  timestamp: '...'
}
```

---

## 7. `callServerTool` - calling the server again from the widget

In this project, widgets call the server again with the following object shape:

```js
const result = await app.callServerTool({
  name: 'getTicket',
  arguments: { ticketId: 'US-001' }
});

const data = result?.structuredContent;
```

### Useful real examples

#### Refresh the ticket list
```js
await app.callServerTool({
  name: 'listTickets',
  arguments: {}
});
```

#### Reset the demo
```js
await app.callServerTool({
  name: 'resetTickets',
  arguments: {}
});
```

#### Save a UI to a ticket
```js
await app.callServerTool({
  name: 'saveUIToTicket',
  arguments: {
    ticketId: 'US-001',
    htmlCode: currentHtml
  }
});
```

#### Load a ticket before preview
```js
const result = await app.callServerTool({
  name: 'getTicket',
  arguments: { ticketId }
});
const ticket = result?.structuredContent?.ticket || result?.structuredContent;
```

---

## 8. External libraries in widgets

Rule:
1. declare the domains in `resourceDomains`
2. load global scripts before the module
3. import as ESM only what actually exposes an ESM export

### Prism.js example in `ui-preview-widget.html`

```html
<link href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"></script>

<script type="module">
  // Prism is global, accessible through window/global name
  Prism.highlightElement(codeContent);
</script>
```

### Fluent example in `tickets-list-widget.html`

```js
import { provideFluentDesignSystem, fluentButton } from 'https://cdn.jsdelivr.net/npm/@fluentui/web-components@2.6.1/+esm';
import { webLightTheme, webDarkTheme } from 'https://cdn.jsdelivr.net/npm/@fluentui/tokens/+esm';

provideFluentDesignSystem().register(fluentButton());
```

---

## 9. `escapeHtml` - mandatory before `innerHTML`

Any data injected into HTML must be escaped.

```js
function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

### Project examples

```js
<h2 class="ticket-title">${escapeHtml(ticket.title)}</h2>
<span class="ticket-id">${escapeHtml(ticket.id)}</span>
<p class="desc-short">${escapeHtml(short)}</p>
```

Without this, a ticket title or description can break the DOM or inject unwanted content.

---

## 10. Widgets in the UI Generator project

### `tickets-list-widget.html`
Use for:
- `listTickets`
- `createTicket`
- `updateTicket`
- `resetTickets`

Interesting patterns:
- backlog display + KPI summary
- inline edit forms
- `callServerTool()` calls to re-read / update tickets
- `app.sendMessage()` to request UI generation from a ticket
- full-screen preview with state restoration via `localStorage`

### `ui-preview-widget.html`
Use for:
- `generateUI`
- `updateUI`
- `generateUIFromTicket`
- `viewTicketUI`

Interesting patterns:
- `srcdoc` iframe to inject the generated HTML
- preview / code toggle
- code highlighting with Prism.js
- copy-to-clipboard
- `requestDisplayMode()` for inline / fullscreen

---

## Quick checklist

- `registerAppTool` for any tool with a widget
- `registerAppResource` for each standalone HTML file
- `result.structuredContent` only
- `</style>` always closed
- `escapeHtml()` before `innerHTML`
- rebind events after rendering, or use event delegation
- `callServerTool()` to call the server again
- CDN domains allowed in `resourceDomains`

---

## Key takeaway

The two most common failure causes are:
1. a widget that reads something other than `result.structuredContent`
2. broken HTML caused by a missing `</style>`

Everything else is mostly about using a good rendering pattern and clean wiring between `registerAppTool`, `registerAppResource`, and `callServerTool()`.
