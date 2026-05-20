# How to update a widget in real time while the AI is working

## The problem
In this project, the user can request a UI change while the preview is already open in fullscreen. The LLM responds in the chat, calls `generateUIFromTicket`, and saves the new HTML on the server. However, the preview widget often keeps showing the old rendering.

The cause is simple: the widget iframe receives no push notification when the ticket data changes on the server side.

## The solution
The chosen solution is lightweight polling with change detection. The widget periodically rereads `getTicket` and compares the new `uiProposal` value with the last known version.

```javascript
let lastHtml = null;

function startPolling(ticketId) {
  return setInterval(async () => {
    const result = await app.callServerTool({
      name: 'getTicket',
      arguments: { ticketId }
    });

    const ticket = result?.structuredContent?.ticket;
    if (ticket?.uiProposal && ticket.uiProposal !== lastHtml) {
      lastHtml = ticket.uiProposal;
      updatePreviewIframe(ticket.uiProposal);
    }
  }, 5000); // every 5 seconds
}
```

### Two polling uses in this project
1. **"Generate" polling**: after a click on **Generate UI** in the board, the widget sends a message to the chat and then queries `getTicket` every 5 seconds until `uiProposal` changes from `null` to complete HTML. As soon as it is ready, it automatically opens the preview in fullscreen.
2. **"Preview" polling**: while the preview is open, the widget keeps querying `getTicket` every 5 seconds. If `uiProposal` changes because the user requested a modification in the chat, the iframe is updated immediately via `srcdoc`.

### Important rule
Always clean up timers when leaving the relevant mode.

```javascript
clearInterval(pollId);
```

Without this cleanup, you accumulate unnecessary requests, ghost updates, and inconsistent state.

### Accepted limitation
Polling every 5 seconds introduces a small delay between the actual end of the LLM's work and the visual refresh. For a demo, this is acceptable. For a more demanding product, a push or event-driven mechanism would be needed.

## Examples
- In `tickets-list-widget.html`, `handleTicketAction()` starts polling after `app.sendMessage(...)` to detect the end of generation.
- In `renderPreview()`, the widget starts another poll to monitor changes to `uiProposal` while the preview is displayed.
- When the user returns to the board, the code calls `clearInterval(...)` before resetting the preview state to `null`.

## Real implementation in `tickets-list-widget.html`

### Preview polling while displayed
The real code does not do abstract polling: it manages the global timer, the exit guardrail, and the reinjection of LLM context.

```javascript
function renderPreview() {
  const mainView = document.getElementById('main-view');
  const previewView = document.getElementById('preview-view');
  mainView.style.display = 'none';
  previewView.style.display = 'flex';
  previewView.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--colorNeutralStroke2,#e5e7eb);background:var(--colorNeutralBackground1,#fff);">
      <button id="btn-back-preview" style="background:none;border:1px solid var(--colorNeutralStroke1,#d1d5db);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px;color:inherit;">← Back</button>
      <h2 style="margin:0;font-size:16px;font-weight:600;">${escapeHtml(state.previewTicketId)} — ${escapeHtml(state.previewTitle)}</h2>
    </div>
    <iframe id="preview-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      style="flex:1;width:100%;border:none;background:#fff;"></iframe>
  `;
  const frame = document.getElementById('preview-frame');
  if (frame) { frame.srcdoc = state.previewHtml; }

  // Poll for UI changes while in preview mode
  if (state.previewPollId) { clearInterval(state.previewPollId); }
  const ticketId = state.previewTicketId;
  if (ticketId && ticketId !== '__standalone__') {
    state.previewPollId = setInterval(async () => {
      if (!state.previewTicketId) { clearInterval(state.previewPollId); state.previewPollId = null; return; }
      try {
        const r = await app.callServerTool({ name: 'getTicket', arguments: { ticketId } });
        const t = r?.structuredContent?.ticket || r?.structuredContent;
        if (t?.uiProposal && t.uiProposal !== state.previewHtml) {
          state.previewHtml = t.uiProposal;
          const f = document.getElementById('preview-frame');
          if (f) { f.srcdoc = t.uiProposal; }
          // Re-inject updated context so the LLM always has the latest version
          try {
            await app.updateModelContext({
              content: [{ type: 'text', text: `The user is viewing the UI for ticket ${ticketId} (${state.previewTitle || ''}). Here is the current HTML code for this UI:\n\n${t.uiProposal}\n\nIf the user requests modifications, use this code as the base and call generateUIFromTicket with the modified code.` }]
            });
          } catch (_) {}
        }
      } catch (_) {}
    }, 5000);
  }

  document.getElementById('btn-back-preview').addEventListener('click', async () => {
    if (state.previewPollId) { clearInterval(state.previewPollId); state.previewPollId = null; }
    state.previewTicketId = null;
    state.previewHtml = null;
    state.previewTitle = null;
    clearPreviewState();
    try { await app.requestDisplayMode({ mode: 'inline' }); } catch (_) {}
  });
}
```

### Generation polling after `app.sendMessage()`
The widget does not launch `generateUIFromTicket` directly. It asks the chat to do it, then waits for `uiProposal` to appear with a maximum of 24 attempts.

```javascript
if (action === 'generate') {
  const prompt = `Generate the UI for ticket ${ticketId}`;
  setBanner(`Sending request...`, 'info');

  try {
    await app.sendMessage({ role: 'user', content: [{ type: 'text', text: prompt }] });
  } catch (e) {
    setBanner(`💡 Type this in the chat: "${prompt}"`, 'info');
    return;
  }

  // Poll for generation completion then auto-open preview
  setBanner(`⏳ Generation in progress...`, 'info');
  let attempts = 0;
  const pollId = setInterval(async () => {
    attempts++;
    if (attempts > 24) {
      clearInterval(pollId);
      setBanner(`Generation completed. Click "View & Edit UI" to see the result.`, 'info');
      return;
    }
    try {
      const r = await app.callServerTool({ name: 'getTicket', arguments: { ticketId } });
      const t = r?.structuredContent?.ticket || r?.structuredContent;
      if (t?.uiProposal) {
        clearInterval(pollId);
        upsertTicketSummary(t);
        renderTickets();
        await openPreview(ticketId);
      }
    } catch (_) {}
  }, 5000);
  return;
}
```

### Reinjection of current HTML into the model context
The key pattern is not just polling, but **polling + `updateModelContext()`**. Two real points show this:

```javascript
await app.updateModelContext({
  content: [{ type: 'text', text: `The user is viewing the UI for ticket ${ticketId} (${ticket.title || ''}). Here is the current HTML code for this UI:\n\n${htmlCode}\n\nIf the user requests modifications, use this code as the base and call generateUIFromTicket with the modified code.` }]
});
```

Then during polling, the widget replaces this context with the fresh version:

```javascript
await app.updateModelContext({
  content: [{ type: 'text', text: `The user is viewing the UI for ticket ${ticketId} (${state.previewTitle || ''}). Here is the current HTML code for this UI:\n\n${t.uiProposal}\n\nIf the user requests modifications, use this code as the base and call generateUIFromTicket with the modified code.` }]
});
```

Without this reinjection, the AI can restart from an older version of the HTML while the iframe is already showing something else.

### Real state pattern to follow
The preview timer is stored in the widget state itself:

```javascript
const state = {
  tickets: [],
  busyTicketId: null,
  isLoaded: false,
  previewTicketId: null,
  previewHtml: null,
  previewTitle: null,
  previewPollId: null,
};
```

The three important details are already coded:
- `state.previewPollId` centralizes the active timer;
- the guardrail `if (!state.previewTicketId) { clearInterval(...); ... return; }` stops polling if we left the preview;
- the back button resets **everything** to `null` before switching back to inline mode.

### Why `getTicket` and not `viewTicketUI`
The choice is explicitly documented in the code:

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

`getTicket` is the safe read model for widgets. `viewTicketUI` is reserved for host routing from the chat, precisely because it opens a resource.

### Triggering generation from the widget
The real pattern on the widget side is: **write in the chat**, not call the generation tool directly.

```javascript
const prompt = `Generate the UI for ticket ${ticketId}`;
await app.sendMessage({ role: 'user', content: [{ type: 'text', text: prompt }] });
```

This pattern lets the LLM perform normal routing (`generateUIFromTicket`) and keeps the widget in a lightweight orchestration role.

### `srcdoc` in the board vs `doc.open()/write()/close()` in the standalone preview
The two widgets do not inject HTML in the same way.

In `tickets-list-widget.html`, the embedded preview updates an already created iframe:

```javascript
const frame = document.getElementById('preview-frame');
if (frame) { frame.srcdoc = state.previewHtml; }

const f = document.getElementById('preview-frame');
if (f) { f.srcdoc = t.uiProposal; }
```

In `ui-preview-widget.html`, the standalone preview widget fully rewrites the iframe document on each tool result:

```javascript
const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
doc.open();
doc.write(htmlCode);
doc.close();
```

Using `srcdoc` is convenient for an iframe already mounted in a widget that stays in control of its state. Using `doc.write(...)` is a better match for the preview widget, which directly receives `structuredContent.htmlCode` via `app.ontoolresult`.
