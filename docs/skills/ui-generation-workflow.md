# How to generate, edit, and save an interface from the Copilot chat

## The problem

This project lets you create complete HTML/CSS/JS interfaces directly in the M365 Copilot chat. But there are **three different ways** to do it, depending on the context. If you do not understand which flow to use, you end up with the wrong tool being called, widgets that do not display, or work that gets lost when saving.

This skill covers the **full cycle**: from a natural-language description to the interface rendered in the side panel, including the server code, LLM routing, and the preview widget.

---

## Data flow architecture

```
User types in the chat
        │
        ▼
M365 Copilot (LLM) reads description_for_model → chooses the right tool
        │
        ▼
MCP tool call on the server (generateUI / updateUI / generateUIFromTicket / createTicket)
        │
        ▼
The server returns { content, structuredContent }
        │
        ▼
M365 Copilot displays content (text) in the chat
        │
        ▼
The widget receives structuredContent via App.ontoolresult()
        │
        ▼
The widget renders the HTML in a sandboxed iframe
```

**Key point**: the LLM does not only generate the description—it also generates **the complete HTML/CSS/JS code** in the `htmlCode` parameter. The MCP server only forwards or stores that code. All generation intelligence is in the LLM.

---

## The three use cases

### Case 1 — Generate a UI from an existing ticket

**When:** the user already has a ticket in the backlog and wants to see what the interface could look like.

**Flow:**

```
"Generate the UI for ticket US-002"
        │
        ▼
  generateUIFromTicket(ticketId, htmlCode)
        │
        ▼
  The HTML is saved on the ticket (uiProposal field)
        │
        ▼
  The preview widget opens with the generated interface
```

**What happens:**
- The LLM reads the ticket description, generates the HTML/CSS/JS, and calls `generateUIFromTicket`.
- The code is **saved directly** on the ticket (written into `tickets.json`).
- The preview widget opens in the Copilot side panel.
- The user can request changes in the chat: “Add an email field”, “Change the theme to dark”. The LLM calls `generateUIFromTicket` again at each iteration.

**Tools involved:** `generateUIFromTicket`

---

### Case 2 — Create a ticket, then generate its UI

**When:** the user wants a ticket AND an interface, but the ticket does not exist yet.

**Flow:**

```
"Create a ticket for a contact form, then generate its interface"
        │
        ▼
  createTicket(title, description, priority)
        │
        ▼
  The ticket appears in the backlog (Ticket Board widget)
        │
        ▼
  generateUIFromTicket(ticketId, htmlCode)
        │
        ▼
  The preview widget opens with the interface
```

**What happens:**
- The LLM first creates the ticket with `createTicket` (the Ticket Board refreshes).
- Then it automatically chains into `generateUIFromTicket` to generate the UI.
- The result is the same as in Case 1: the HTML is on the ticket, and the preview opens.

**Tools involved:** `createTicket` → `generateUIFromTicket`

---

### Case 3 — Work on a standalone UI, without a ticket

**When:** the user just wants to prototype an interface without creating a ticket. This is the “sandbox” mode.

**Flow:**

```
"I want to create an expense reimbursement interface, dark theme, orange title"
        │
        ▼
  generateUI(description, htmlCode)
        │
        ▼
  The preview widget opens with the interface
        │
        ▼
  "Add a supporting documents section with file upload"
        │
        ▼
  updateUI(description, htmlCode)
        │
        ▼
  The preview widget updates
        │
        ▼
  (Optional) "Save this in a ticket"
        │
        ▼
  createTicket(title, description, htmlCode)  ← WITH htmlCode!
        │
        ▼
  The ticket is created with the UI already saved
```

**What happens:**
- The LLM uses `generateUI` for the first generation (no ticket, no server-side save).
- Changes go through `updateUI` (same logic, just updated code).
- The preview widget opens and updates at each iteration.
- **Critical point:** when the user wants to save, the LLM must call `createTicket` **with the `htmlCode` parameter** containing the latest HTML from the conversation. Without it, the ticket is created empty and all the work is lost.

**Tools involved:** `generateUI` → `updateUI` (×N) → `createTicket` with `htmlCode`

---

## Server-side implementation (MCP tools)

UI generation tools are registered in `mcp-server/src/mcp-server.ts` with `registerAppTool` from the package `@modelcontextprotocol/ext-apps/server`.

### generateUI — standalone generation (Case 3)

```typescript
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';

const PREVIEW_URI = 'ui://uigenerator/preview.html';

registerAppTool(
  server,
  'generateUI',
  {
    description: 'Generate a complete HTML/CSS/JS interface from a description',
    inputSchema: {
      description: z.string().describe('Description of the generated interface'),
      htmlCode: z.string().describe('Complete self-contained HTML/CSS/JS code'),
    },
    // _meta.ui.resourceUri → tells the M365 host to open the preview.html widget
    _meta: { ui: { resourceUri: PREVIEW_URI } },
  },
  async ({ description, htmlCode }) => {
    // No server-side save! The HTML is only forwarded to the widget.
    return {
      content: [{ type: 'text' as const, text: `Generated interface: ${description}` }],
      structuredContent: {
        type: 'generate',       // the widget uses this field for the "Generated" badge
        description,
        htmlCode,               // ← the full code travels in structuredContent
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

**Important points:**
- `_meta.ui.resourceUri: PREVIEW_URI` → tells the M365 Copilot host to open the `ui-preview-widget.html` widget when this tool returns a result.
- `structuredContent.htmlCode` → this is what the widget receives through `App.ontoolresult()`.
- **No file save**: the HTML is only in the response. If the user reloads the page, it is lost (this is intentional—sandbox mode).

### updateUI — iterative modification (Case 3)

```typescript
registerAppTool(
  server,
  'updateUI',
  {
    description: 'Update the existing interface with the requested changes',
    inputSchema: {
      description: z.string().describe('Description of the changes made'),
      htmlCode: z.string().describe('Complete updated HTML/CSS/JS code'),
    },
    _meta: { ui: { resourceUri: PREVIEW_URI } },
  },
  async ({ description, htmlCode }) => {
    return {
      content: [{ type: 'text' as const, text: `Updated interface: ${description}` }],
      structuredContent: {
        type: 'update',         // the widget displays "Updated" instead of "Generated"
        description,
        htmlCode,
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

**Identical to `generateUI`** except for `type: 'update'` in `structuredContent`. The widget displays a different badge, but rendering is the same.

### generateUIFromTicket — generation tied to a ticket (Cases 1 and 2)

```typescript
registerAppTool(
  server,
  'generateUIFromTicket',
  {
    description: 'Generate an HTML/CSS/JS interface from a ticket description, then save the UI proposal on that ticket',
    inputSchema: {
      ticketId: z.string().describe('Ticket identifier (example: US-001)'),
      htmlCode: z.string().describe('Generated complete HTML/CSS/JS code'),
    },
    _meta: { ui: { resourceUri: PREVIEW_URI } },
  },
  async ({ ticketId, htmlCode }) => {
    // Server-side save → the ticket is updated
    const tickets = loadTickets();
    const { ticket, index } = findTicket(tickets, ticketId);
    const updatedTicket: Ticket = { ...ticket, uiProposal: htmlCode };
    tickets[index] = updatedTicket;
    saveTickets(tickets);

    return {
      content: [{ type: 'text' as const, text: `Generated UI proposal saved for ${ticketId}.` }],
      structuredContent: {
        type: 'generate',
        ticketId,
        title: updatedTicket.title,
        description: updatedTicket.description,
        htmlCode,
        ticket: updatedTicket,   // the full ticket for reference
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

**Key difference from `generateUI`**: here the HTML is **written into `tickets.json`** (`uiProposal` field). The Ticket Board widget can then detect that the ticket has a UI (button "View & Edit UI" vs "Generate UI").

### createTicket with htmlCode — saving a standalone UI (Case 3 → ticket)

```typescript
registerAppTool(
  server,
  'createTicket',
  {
    description: 'Create a new ticket in the UI backlog. If htmlCode is provided, also save the UI proposal directly.',
    inputSchema: {
      title: z.string(),
      description: z.string(),
      priority: z.enum(['High', 'Medium', 'Low']).optional(),
      assignee: z.string().optional(),
      htmlCode: z.string().optional(),  // ← OPTIONAL but crucial for Case 3
    },
    _meta: { ui: { resourceUri: TICKETS_LIST_URI } },
  },
  async ({ title, description, priority, assignee, htmlCode }) => {
    const tickets = loadTickets();
    const maxNum = tickets.reduce((max, t) => {
      const m = t.id.match(/^US-(\d+)$/);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const newId = `US-${String(maxNum + 1).padStart(3, '0')}`;
    const newTicket: Ticket = {
      id: newId,
      title,
      description,
      priority: priority ?? 'Medium',
      status: 'To Do',
      assignee: assignee ?? 'Unassigned',
      uiProposal: htmlCode || null,    // ← If htmlCode is provided, the UI is on the ticket
    };
    tickets.push(newTicket);
    saveTickets(tickets);

    return {
      content: [{ type: 'text' as const, text: `Ticket ${newId} created: ${title}` }],
      structuredContent: {
        tickets: summarizeTickets(tickets),  // the full list for the Ticket Board
        createdTicketId: newId,
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

**The `htmlCode` parameter is optional but vital.** When it is provided, the ticket is created with the UI already in place. When it is missing, the ticket is created without a UI and the work from the conversation is lost.

---

## Widget-side implementation (`ui-preview-widget.html`)

The preview widget is the file `mcp-server/assets/ui-preview-widget.html`. It is a standalone HTML file that runs inside a sandboxed iframe in M365 Copilot.

### Registration as an MCP resource

```typescript
const previewWidgetHtml = readFileSync(join(__dirname, '../assets/ui-preview-widget.html'), 'utf8');
const PREVIEW_URI = 'ui://uigenerator/preview.html';

registerAppResource(
  server,
  'UI Preview Widget',
  PREVIEW_URI,
  { description: 'Preview widget for generated interfaces' },
  async () => ({
    contents: [{
      uri: PREVIEW_URI,
      mimeType: RESOURCE_MIME_TYPE,   // 'application/vnd.mcp.ext-apps.widget+html'
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
    }],
  }),
);
```

**Important points:**
- `RESOURCE_MIME_TYPE` = `'application/vnd.mcp.ext-apps.widget+html'` → tells M365 that this is an HTML widget.
- `csp.resourceDomains` → allowlist of CDNs allowed in the iframe (see skill [mcp-app-csp-resources.md](mcp-app-csp-resources.md)).
- The widget is read when the server starts and served as-is.

### Receiving data in the widget

The widget uses the `@modelcontextprotocol/ext-apps` SDK on the client side:

```javascript
import { App } from 'https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps/+esm';

const app = new App({ name: 'ui-preview', version: '1.0.0' });

app.ontoolresult = (result) => {
  // ⚠️ Data is ALWAYS in result.structuredContent
  // NOT in result.data, NOT in result.content, NOT in result directly
  const data = result.structuredContent;

  if (data && data.htmlCode) {
    showPreview(data.htmlCode, data.description || '', data.type || 'generate');
  } else {
    showError('No HTML code received.');
  }
};

await app.connect();
```

**Classic trap**: `result.structuredContent`, not `result.data`. This is the #1 source of errors when creating a new widget.

### Injecting HTML into the preview iframe

```javascript
function showPreview(htmlCode, description, type) {
  currentHtmlCode = htmlCode;

  // Direct injection into the iframe — the HTML generated by the LLM becomes a complete page
  const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
  doc.open();
  doc.write(htmlCode);
  doc.close();

  // "Generated" or "Updated" badge
  statusBadge.textContent = type === 'update' ? 'Updated' : 'Generated';
  infoBar.textContent = description;

  // Auto-open fullscreen on first generation
  if (!isFullscreen) {
    isFullscreen = true;
    try { app.requestDisplayMode({ mode: 'fullscreen' }); } catch (_) {}
  }
}
```

**Why `doc.open/write/close`?** Because the HTML generated by the LLM is a **complete** HTML document (with `<!DOCTYPE>`, `<html>`, `<style>`, `<script>`...). You cannot just set `innerHTML`—you need to replace the entire iframe document.

### Code / Preview view (toggle)

The widget has two display modes: the visual rendering (iframe) and the source code (PrismJS):

```javascript
let showingCode = false;

btnToggle.addEventListener('click', () => {
  showingCode = !showingCode;
  if (showingCode) {
    previewEl.style.display = 'none';
    codeView.style.display = 'block';
    codeContent.textContent = currentHtmlCode;   // raw code in a <code>
    Prism.highlightElement(codeContent);          // syntax highlighting
    // The button changes from "Code" to "Preview"
  } else {
    previewEl.style.display = 'block';
    codeView.style.display = 'none';
    // The button switches back to "Code"
  }
});
```

**Libraries used:**
- [PrismJS](https://prismjs.com/) for syntax highlighting (theme `prism-tomorrow` = dark background)
- `line-numbers` plugin for line numbers
- Loaded via CDN (declared in `csp.resourceDomains`)

### Copy button

```javascript
btnCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(currentHtmlCode);
  btnCopy.textContent = 'Copied!';
  setTimeout(() => { btnCopy.textContent = 'Copy'; }, 1500);
});
```

### Fullscreen and Back

```javascript
// Open in fullscreen (MCP Apps API)
btnOpen.addEventListener('click', async () => {
  await app.requestDisplayMode({ mode: 'fullscreen' });
  isFullscreen = true;
});

// Return to inline mode (side panel)
btnBack.addEventListener('click', async () => {
  await app.requestDisplayMode({ mode: 'inline' });
  isFullscreen = false;
});
```

**Auto-fullscreen behavior**: on first data reception (`showPreview`), the widget automatically switches to fullscreen. This gives a better experience because the generated interface is too small in the side panel (~400px).

---

## LLM routing — how the right tool is chosen

### description_for_model (`ai-plugin.json`)

The most important field in the project. It is a **single text block** that the LLM reads as an instruction. It contains the routing rules between the 3 cases:

```json
{
  "description_for_model": "UI ticket management plugin and web interface generation. THREE USE CASES: CASE 1 - UI from an existing ticket: use generateUIFromTicket to generate or modify the UI of an existing ticket. CASE 2 - Create a ticket then its UI: first createTicket, then generateUIFromTicket. CASE 3 - Standalone UI WITHOUT ticket: when the user just wants an interface without mentioning a ticket, use generateUI to create and updateUI to modify. [...] IMPORTANT: when the user asks to create a ticket after working on a standalone UI, ALWAYS include htmlCode in createTicket so the work is not lost."
}
```

**Techniques that work:**
- Keywords in **UPPERCASE**: `ALWAYS`, `NEVER`, `IMPORTANT`, `RULE`
- Numbered cases: `CASE 1`, `CASE 2`, `CASE 3`
- Absolute rules instead of soft suggestions: “ALWAYS include” vs “can include”
- Repeat the same rule in `description_for_model` AND in `instruction.txt`

### instruction.txt (agent system prompt)

The file `appPackage/instruction.txt` is the system prompt sent to the LLM. It reinforces the routing rules and adds HTML generation instructions:

```
## Generation rules
- Modern, clean, responsive design
- CSS embedded in a <style> block
- Self-contained code in a single HTML file
- No external dependencies unless requested

## Workflow
### Standalone generation
1. If the user describes a UI without a ticket → generateUI
2. To modify the current UI → updateUI (full HTML code, not just the diff)

### Ticket workflow
1. "generate the UI for ticket US-001" → generateUIFromTicket
2. To save a standalone UI → createTicket with htmlCode
```

---

## The ticket schema

Each ticket is stored in `mcp-server/data/tickets.json`:

```typescript
type Ticket = {
  id: string;            // "US-001", "US-002"...
  title: string;         // Short title
  description: string;   // Detailed functional description (user story)
  priority: 'High' | 'Medium' | 'Low';
  status: 'To Do' | 'In Progress' | 'Done';
  assignee: string;      // Name or "Unassigned"
  uiProposal: string | null;  // ← The full HTML/CSS/JS code, or null
};
```

**The `uiProposal` field** is the key: this is where the HTML is stored when using `generateUIFromTicket` or `createTicket` with `htmlCode`. The Ticket Board widget uses this field to display either "Generate UI" (if null) or "View & Edit UI" (if filled).

---

## Summary of structuredContent by tool

Each tool returns a different `structuredContent` format. The widget must know what to do with it:

### generateUI / updateUI

```json
{
  "type": "generate",       // or "update"
  "description": "Interface description",
  "htmlCode": "<!DOCTYPE html>...",
  "timestamp": "2026-05-20T..."
}
```

→ The widget reads `data.htmlCode` and injects it into the iframe.

### generateUIFromTicket

```json
{
  "type": "generate",
  "ticketId": "US-002",
  "title": "Landing Page Hero Section",
  "description": "As a visitor, I want a hero section...",
  "htmlCode": "<!DOCTYPE html>...",
  "ticket": { /* full ticket */ },
  "timestamp": "2026-05-20T..."
}
```

→ Same handling on the widget side (`data.htmlCode` → iframe). The difference is on the server side (save into `tickets.json`).

### createTicket (with or without htmlCode)

```json
{
  "tickets": [
    { "id": "US-001", "title": "...", "hasUiProposal": false },
    { "id": "US-002", "title": "...", "hasUiProposal": true }
  ],
  "createdTicketId": "US-004",
  "timestamp": "2026-05-20T..."
}
```

→ This format is consumed by the **Ticket Board** (not the preview). The `hasUiProposal` field (boolean) determines which button to display for each ticket.

---

## Technical differences between tools (summary table)

| Tool | Server-side save | `resourceUri` | Widget opened | `structuredContent.htmlCode` |
|-------|-------------------|---------------|---------------|------------------------------|
| `generateUI` | No | `preview.html` | Preview | Yes |
| `updateUI` | No | `preview.html` | Preview | Yes |
| `generateUIFromTicket` | Yes (`uiProposal`) | `preview.html` | Preview | Yes |
| `createTicket` with `htmlCode` | Yes (ticket + UI) | `tickets-list.html` | Ticket Board | No (ticket list) |
| `createTicket` without `htmlCode` | Yes (ticket only) | `tickets-list.html` | Ticket Board | No |
| `saveUIToTicket` | Yes (`uiProposal`) | — | None | No |

---

## Examples of prompts and expected result

| User prompt | Case | Tools called |
|---|---|---|
| “Generate the UI for ticket US-001” | 1 | `generateUIFromTicket` |
| “Modify the interface of US-002: add a dark mode” | 1 | `generateUIFromTicket` |
| “Create a ticket for an HR dashboard and generate its UI” | 2 | `createTicket` → `generateUIFromTicket` |
| “I want an expense reimbursement interface” | 3 | `generateUI` |
| “Add a date field and a currency selector” | 3 | `updateUI` |
| “Save this interface in a ticket” | 3→ticket | `createTicket` with `htmlCode` |

---

## The classic trap: losing work when saving

The most frequent problem happens in **Case 3** when the user has spent several iterations refining a standalone UI, then asks “create a ticket with this”.

If the LLM calls `createTicket` **without** the `htmlCode` parameter, the ticket is created but **the UI is not saved**. All the work from the conversation is lost.

**The solution:** `description_for_model` contains an explicit rule:

> *IMPORTANT: when the user asks to create a ticket after working on a standalone UI, ALWAYS include htmlCode in createTicket so the work is not lost.*

If the LLM still forgets `htmlCode`, you need to reinforce the rule in `instruction.txt` with absolute wording (`ALWAYS`, `NEVER`). See [llm-tool-routing.md](llm-tool-routing.md) for reinforcement techniques.

---

## Key files

| File | Role |
|---------|------|
| `mcp-server/src/mcp-server.ts` | Registration of all MCP tools and resources |
| `mcp-server/assets/ui-preview-widget.html` | Preview widget (iframe + code + fullscreen) |
| `mcp-server/assets/tickets-list-widget.html` | Ticket Board widget |
| `mcp-server/data/tickets.json` | Ticket data (runtime, modifiable) |
| `mcp-server/data/tickets-default.json` | Initial data (demo reset) |
| `appPackage/ai-plugin.json` | LLM routing (`description_for_model`) + tool schemas |
| `appPackage/instruction.txt` | Agent system prompt (HTML generation rules) |

---

## To add a new UI generation tool

If you want to add a new generation type (for example `generateUIFromTemplate`), here is the pattern:

1. **Register the tool** in `mcp-server.ts` with `registerAppTool`:
   - `inputSchema` with `z.string()` for parameters
   - `_meta: { ui: { resourceUri: PREVIEW_URI } }` to open the preview
   - Return `structuredContent` with `htmlCode`

2. **Add the declaration** in `ai-plugin.json`:
   - `functions[]` section for the short description
   - `runtimes[0].spec.x-mcp_tool_description.tools[]` section for the full schema
   - `run_for_functions[]` section to enable it

3. **Update `description_for_model`** so the LLM knows when to use this new tool

4. **The widget does not need to change** as long as `structuredContent` contains `htmlCode`—it will render it automatically.

---

## Related skills

- [llm-tool-routing.md](llm-tool-routing.md) — How to configure `description_for_model` so the LLM chooses the right tool
- [widget-display-and-resourceuri.md](widget-display-and-resourceuri.md) — How `resourceUri` controls which widget opens
- [widget-realtime-updates.md](widget-realtime-updates.md) — How the preview updates automatically while the LLM is working
- [widget-fullscreen-and-state.md](widget-fullscreen-and-state.md) — How fullscreen preserves widget state
- [mcp-app-csp-resources.md](mcp-app-csp-resources.md) — How to unblock CDNs inside M365 iframes
