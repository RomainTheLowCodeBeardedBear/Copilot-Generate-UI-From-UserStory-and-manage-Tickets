# How to Guide the LLM to Choose the Right Tool

## The problem
With 10 tools available, the LLM can easily take the wrong path if the routing rules are ambiguous. In this project, the classic case is this: the user says “create an interface for a dashboard” and the model may choose `generateUIFromTicket` even though no ticket exists. The correct tool is then `generateUI`.

## The solution
The main lever is `description_for_model` in `appPackage\ai-plugin.json`. It is the most important field in the project for tool routing. In practice, the model mostly reads this block as a continuous instruction. So you should write **a single paragraph**, with explicit, unambiguous rules.

Example of effective wording in this project:

```text
THREE USE CASES:
CASE 1 - UI from an existing ticket: use generateUIFromTicket
CASE 2 - Create a ticket then its UI: first createTicket, then generateUIFromTicket
CASE 3 - Standalone UI WITHOUT a ticket: use generateUI to create and updateUI to modify
RULE: if the user mentions a ticket or a ticket ID → CASE 1 or 2
If the user only asks "create an interface for X" without a ticket → CASE 3
```

### Another lever: `instruction.txt`
The `appPackage\instruction.txt` file acts as reinforcement. It must repeat the same rules as `description_for_model`, not contradict them. In this project, for example, it reminds the model of:
- `generateUI` / `updateUI` for standalone generations;
- `generateUIFromTicket` for ticket-related requests;
- `createTicket` with `htmlCode` to save a standalone UI into a ticket.

### Common pitfalls
- Do not assume the LLM will read each tool description in detail: it relies first on `description_for_model`.
- Do not use soft wording like “can use.” Prefer `MUST`, `ALWAYS`, `NEVER`.
- Test each case separately and verify which tool was actually chosen.
- If the model still gets it wrong, make the rule more explicit with uppercase keywords.

### A pattern that works well
Absolute directives work better than nuance:
- **ALWAYS** use `generateUIFromTicket` for a UI tied to a ticket.
- **NEVER** use `generateUIFromTicket` if the user does not mention a ticket.
- **ALWAYS** include `htmlCode` in `createTicket` when saving an already generated standalone UI.

## Examples
- “Create an interface for an HR dashboard” → `generateUI`.
- “Add a filter and a KPI column to the current interface” → `updateUI`.
- “Generate the UI for ticket US-001” → `generateUIFromTicket`.
- “Create a ticket for a profile page, then generate its UI” → `createTicket`, then `generateUIFromTicket`.
- “Save this standalone UI into a ticket” → `createTicket` with `htmlCode` containing the latest known HTML.

## Real routing artifacts to copy

### Full `description_for_model` (`appPackage\ai-plugin.json`)
This is the most important block in the project for tool selection. Here is the exact value currently embedded:

```json
"description_for_model": "UI ticket management and web interface generation plugin. THREE USE CASES: CASE 1 - UI from an existing ticket: use generateUIFromTicket to generate or modify the UI of an existing ticket. CASE 2 - Create a ticket then its UI: first createTicket, then generateUIFromTicket. CASE 3 - Standalone UI WITHOUT a ticket: when the user just wants an interface without mentioning a ticket, use generateUI to create and updateUI to modify. The UI is displayed in the side panel. When the user then wants to save it in a ticket, call createTicket with the htmlCode parameter containing the LATEST HTML code generated/modified in the conversation. RULE: if the user mentions a ticket or a ticket ID, use CASE 1 or 2. If the user only asks 'create an interface for X' without mentioning a ticket, use CASE 3 (generateUI/updateUI). IMPORTANT: when the user asks to create a ticket after working on a standalone UI, ALWAYS include htmlCode in createTicket so the work is not lost."
```

### `instruction.txt` repeats the expected workflow
The `appPackage\instruction.txt` file does not replace `description_for_model`: it reinforces it. The sections actually read by the model are:

```text
## Available functions

### generateUI
Generate a complete HTML/CSS/JS interface from a natural-language description. The generated code is automatically shown in the side widget.

### updateUI
Update the existing interface according to the changes requested by the user. Keep the context of what was previously generated and apply only the requested changes.

### generateUIFromTicket
Generate an HTML/CSS/JS interface from a ticket description, then save this UI proposal on the ticket. The HTML code is provided in the tool call and the preview is shown in the side widget.

## Workflow

### Standalone generation
1. If the user describes a UI without a ticket, call `generateUI` with a detailed description and the full HTML code.
2. The widget displays the generated interface.
3. Briefly describe what was generated and the included features.

### Iterative changes
1. If the user asks for a change to the current interface, call `updateUI` with the full updated HTML code (not just the diff).
2. The widget updates the display.
3. Confirm the changes that were made.

### Ticket workflow
1. If the user says "show my tickets", "list tickets", "show my tickets" or "list the tickets", call `listTickets`.
2. If the user wants to view a specific ticket, call `getTicket`.
3. If the user clicks **Generate UI** in the tickets widget, or asks "generate UI for US-001" / "generate the UI for ticket US-001", call `generateUIFromTicket`.
4. If the ticket description is not already available in the context, first call `getTicket`, then generate the full HTML and call `generateUIFromTicket` with `ticketId` + `htmlCode`.
5. If the user clicks **View UI**, or wants to see an existing proposal, call `getTicket`.
6. After an iteration with `updateUI`, if the user says "save to ticket", "save UI to ticket" or "save to the ticket", call `saveUIToTicket` with `ticketId` + the final full HTML code.
7. It does not replace `generateUI` / `updateUI`: they remain the default workflow for standalone generations without a ticket.
```

### `functions[]` = secondary routing hints
The top-level `functions[]` adds a finer layer of hints. Here is the real excerpt:

```json
"functions": [
  {
    "name": "generateUI",
    "description": "Generate a complete HTML/CSS/JS interface from a standalone description. For UIs without an associated ticket. The result is shown in the side panel."
  },
  {
    "name": "updateUI",
    "description": "Modify the existing interface shown in the side panel. Send the full updated HTML code."
  },
  {
    "name": "listTickets",
    "description": "List UI backlog tickets with status, priority, assignee, and UI proposal state."
  },
  {
    "name": "getTicket",
    "description": "Retrieve the full details of a ticket, including the UI proposal if it already exists."
  },
  {
    "name": "generateUIFromTicket",
    "description": "Generate or modify an HTML/CSS/JS interface from a ticket description and save it to the ticket. ALWAYS use this tool for any UI creation or modification tied to a ticket."
  },
  {
    "name": "saveUIToTicket",
    "description": "Save the final version of an HTML/CSS/JS interface to an existing ticket."
  },
  {
    "name": "createTicket",
    "description": "Create a new ticket. If htmlCode is provided, also save the UI proposal. Use when the user wants to save a standalone UI into a ticket."
  },
  {
    "name": "updateTicket",
    "description": "Update ticket fields (title, description, status, priority, assignee)."
  },
  {
    "name": "resetTickets",
    "description": "Reset all tickets to their initial state to run a clean demo again."
  },
  {
    "name": "viewTicketUI",
    "description": "Display a ticket's UI proposal in the side preview panel."
  }
]
```

These descriptions act as **secondary routing hints**:
- `generateUI` explicitly contains **"without an associated ticket"**;
- `updateUI` contains **"existing interface"**;
- `generateUIFromTicket` contains **"ticket"** + **"ALWAYS"**;
- `createTicket` contains **"save a standalone UI"**.

When `description_for_model` is ambiguous, this short vocabulary often tips the final choice.

### The detailed descriptions in `x-mcp_tool_description.tools[]`
The MCP runtime also redeclares the tools with their schemas. Real example for `generateUI`:

```json
{
  "name": "generateUI",
  "description": "Generate a complete HTML/CSS/JS interface from a standalone description (without a ticket). The result is shown in the side panel.",
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

Here, the phrase **"standalone description (without a ticket)"** is another routing hint. The descriptions in `functions[]` and `x-mcp_tool_description.tools[]` must tell the same story.

### Real conversation starters (`ai-plugin.json`)
These prompts are useful as routing test cases:

```json
"conversation_starters": [
  { "text": "Show me the available UI tickets" },
  { "text": "Generate a modern contact form" },
  { "text": "Generate a UI for ticket US-001" },
  { "text": "Create a landing page with hero and features" }
]
```

You can immediately see the three intended branches: ticket board, standalone UI, and ticket-linked UI.

## Routing declaration: two sources to keep in sync

### Server side (`mcp-server\src\mcp-server.ts`)
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
```

### Plugin side (`appPackage\ai-plugin.json`)
```json
{
  "name": "generateUI",
  "_meta": {
    "ui": { "resourceUri": "ui://uigenerator/preview.html" },
    "ui/resourceUri": "ui://uigenerator/preview.html"
  }
}
```

If these two layers diverge, you get a system that is hard to diagnose: the LLM may choose the right tool, but the wrong widget opens; or conversely, the host opens a widget that no longer matches the story told by `description_for_model`.

## How to debug bad routing
1. **Start with `description_for_model`**: check whether the business rule is written there in absolute terms (`ALWAYS`, `WITHOUT a ticket`, `CASE 1/2/3`).
2. **Compare `instruction.txt`**: it must repeat the same rule, especially in `## Workflow`.
3. **Re-read `functions[]`**: short phrases like `without an associated ticket`, `existing interface`, `ticket`, `ALWAYS` really influence selection.
4. **Re-read `x-mcp_tool_description.tools[]`**: description, schema, and `_meta` must tell the same story as `functions[]`.
5. **Compare with the server**: in `mcp-server\src\mcp-server.ts`, verify `registerAppTool(...)`, the `description`, the `inputSchema`, and `_meta.ui.resourceUri`.
6. **Test with minimal prompts**:
   - `Generate a modern contact form` → should go to `generateUI`
   - `Generate a UI for ticket US-001` → should go to `generateUIFromTicket`
   - `Show me the available UI tickets` → should go to `listTickets`
7. **If the error persists**: strengthen `description_for_model` first, then only afterward the individual tool descriptions.

