# How to handle fullscreen without losing widget state

## The problem
In this project, `app.requestDisplayMode({ mode: 'fullscreen' })` does not reuse the current iframe. The host creates a **new iframe**. So all JavaScript memory is lost: variables, event listeners, timers, DOM references, everything starts over from zero.

### Symptom
The user clicks the fullscreen button, but the widget shows its initial state or its loading screen instead of the expected content.

## The solution
The right solution is to save the **minimal restorable state** in `localStorage`, with a very short expiration.

```javascript
// Before switching to fullscreen: save the ticketId
localStorage.setItem('preview_ticket', JSON.stringify({
  id: ticketId,
  ts: Date.now()
}));
app.requestDisplayMode({ mode: 'fullscreen' });

// On startup: reread localStorage
const saved = JSON.parse(localStorage.getItem('preview_ticket') || 'null');
if (saved && Date.now() - saved.ts < 10000) { // 10 s expiration
  localStorage.removeItem('preview_ticket');
  // Restore state from saved.id
  const result = await app.callServerTool({
    name: 'getTicket',
    arguments: { ticketId: saved.id }
  });
  // Re-render with the restored data
}
```

### Why a 10-second expiration
The goal is not to persist durable business state. We only want to survive the time needed for the fullscreen iframe to be recreated and reread the value. Ten seconds is more than enough for that transfer, while avoiding an old value being reused later by mistake.

### The Back button
To return to compact view, use `app.requestDisplayMode({ mode: 'inline' })`.

Do not use `app.requestTeardown()`. That method completely destroys the widget, whereas here we only want to change the display mode.

### Variant actually used in this project
The file `mcp-server\assets\tickets-list-widget.html` applies this pattern with two separate keys: `uigen_preview_id` and `uigen_preview_ts`. The principle is the same: save an identifier just before fullscreen, reread that information when the new iframe starts, then remove it immediately.

## Examples
- In `openPreview()`, the widget saves the ticket identifier before `requestDisplayMode({ mode: 'fullscreen' })`.
- When the widget starts, `loadPreviewState()` reads `localStorage`, checks the age of the data, then calls `await openPreview(pendingPreviewId)` to restore the expected screen.
- The **Back** button in preview mode calls `requestDisplayMode({ mode: 'inline' })` to return to the board without destroying the component.

## Real implementation in `tickets-list-widget.html`

### Exact `localStorage` helpers
The project does not use a generic example: it stores two scalar keys with a 10-second validity window.

```javascript
function savePreviewState(ticketId) {
  try {
    localStorage.setItem('uigen_preview_id', ticketId);
    localStorage.setItem('uigen_preview_ts', String(Date.now()));
  } catch (_) {}
}
function loadPreviewState() {
  try {
    const id = localStorage.getItem('uigen_preview_id');
    const ts = localStorage.getItem('uigen_preview_ts');
    if (id && ts && (Date.now() - parseInt(ts, 10)) < 10000) return id;
  } catch (_) {}
  return null;
}
function clearPreviewState() {
  try {
    localStorage.removeItem('uigen_preview_id');
    localStorage.removeItem('uigen_preview_ts');
  } catch (_) {}
}
```

### State actually tracked by the widget
Fullscreen is not handled by an isolated variable, but by a subset of the global state:

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

`previewTicketId`, `previewHtml`, and `previewTitle` are used to rebuild the screen. `previewPollId` is used to stop the timer cleanly when returning inline.

### Restoration when the module starts
The restoration pattern is at the very end of the file, after `app.connect()` and theme initialization:

```javascript
// Check whether we should restore preview mode (widget re-created in fullscreen)
const pendingPreviewId = loadPreviewState();
if (pendingPreviewId) {
  clearPreviewState();
  await openPreview(pendingPreviewId);
} else {
  renderTickets();
}
```

This point is essential: the restored widget does not try to rebuild the preview from a rich local cache. It restarts the normal `openPreview(ticketId)` flow.

### Full `openPreview()` flow
The real sequence is: `getTicket` → in-memory state → `savePreviewState()` → `updateModelContext()` → `requestDisplayMode()` → `renderPreview()`.

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

### Real cleanup of the Back button
Returning inline does not destroy the widget; it clears local state and then simply requests another display mode.

```javascript
document.getElementById('btn-back-preview').addEventListener('click', async () => {
  if (state.previewPollId) { clearInterval(state.previewPollId); state.previewPollId = null; }
  state.previewTicketId = null;
  state.previewHtml = null;
  state.previewTitle = null;
  clearPreviewState();
  try { await app.requestDisplayMode({ mode: 'inline' }); } catch (_) {}
});
```

### Why two keys (`uigen_preview_id` + `uigen_preview_ts`) instead of a JSON blob
The real code shows a deliberately simple choice:
- direct reading without `JSON.parse()`;
- easy atomic writing of the date and identifier;
- explicit field-by-field deletion;
- better robustness in a silent `try/catch` if one of the keys is missing or corrupted.

A JSON blob would also have worked, but this version is more tolerant for a very short state transfer between two iframes.

### Auto-fullscreen in `ui-preview-widget.html`
The standalone preview has its own pattern: the first tool result automatically switches to fullscreen in `showPreview()`.

```javascript
function showPreview(htmlCode, description, type) {
  loadingEl.style.display = 'none';
  errorEl.style.display = 'none';
  infoBar.style.display = 'block';
  btnToggle.style.display = 'flex';

  currentHtmlCode = htmlCode;

  if (showingCode) {
    previewEl.style.display = 'none';
    codeView.style.display = 'block';
    codeContent.textContent = htmlCode;
    Prism.highlightElement(codeContent);
  } else {
    previewEl.style.display = 'block';
    codeView.style.display = 'none';
  }

  const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
  doc.open();
  doc.write(htmlCode);
  doc.close();

  const label = type === 'update' ? 'Updated' : 'Generated';
  statusBadge.textContent = label;
  infoBar.textContent = description;

  // Auto-open fullscreen on first generation
  if (!isFullscreen) {
    isFullscreen = true;
    btnOpen.style.display = 'none';
    btnBack.style.display = 'flex';
    try { app.requestDisplayMode({ mode: 'fullscreen' }); } catch (_) {}
  }
}
```

### `requestDisplayMode({ mode: 'inline' })` vs `requestTeardown()`
In this project:
- `requestDisplayMode({ mode: 'fullscreen' })` or `inline` = ask the host to change the **display mode** of the same logical widget;
- `requestTeardown()` = ask for the widget to be closed/destroyed.

The ticket board uses `inline` on the way back because it wants to preserve the user scenario: return to the backlog, not close the whole experience.
