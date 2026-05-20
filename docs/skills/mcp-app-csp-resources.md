# Skill: MCP App CSP - `resourceDomains`

> Short but critical. Without this configuration, external resources in the **UI Generator project** are silently blocked by M365.

---

## The problem

MCP App widgets run inside an **M365 sandboxed iframe**. M365's CSP (Content Security Policy) blocks external resources by default: CDN scripts, stylesheets, fonts, images, ESM modules, and so on.

Typical symptoms:
- the widget loads only partially
- some libraries seem present but do not work
- fonts are not applied
- Prism.js code highlighting does not appear
- no clear message is visible in the UI

The blocking is often **silent**.

---

## The solution: `_meta.ui.csp.resourceDomains`

Each widget registered through `registerAppResource` must explicitly declare the external domains it uses.

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

---

## Common domains to declare for this project

| Usage | Domains to add |
|---|---|
| Fluent UI Web Components | `unpkg.com` |
| ext-apps MCP Apps (`App` module) | `cdn.jsdelivr.net` |
| Fluent tokens / ESM packages served through a CDN | `cdn.jsdelivr.net` |
| Prism.js CSS/JS (code highlighting in `ui-preview-widget.html`) | `cdn.jsdelivr.net` |
| Google Fonts / stylesheets | `fonts.googleapis.com` |
| Google font files | `fonts.gstatic.com` |

### Realistic example for `ui-preview-widget.html`

The preview widget uses code highlighting and may load styles / modules from a CDN.

```ts
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
```

### Realistic example for `tickets-list-widget.html`

The backlog widget has a simpler surface area and may only need `cdn.jsdelivr.net` if its imports come only from jsDelivr.

```ts
_meta: {
  ui: {
    csp: {
      resourceDomains: ['cdn.jsdelivr.net']
    }
  }
}
```

---

## ⚠️ Important pitfalls

### 1. The blocking is silent
M365 does not always display an obvious error. The symptoms can be very subtle:
- empty or partially styled widget
- missing Fluent components
- Prism.js not loaded
- fonts replaced by a system font
- visual rendering differs between inline / fullscreen

### 2. CSP configuration is **per resource**, not global
Each `registerAppResource()` call has its own `resourceDomains` list.

If the project has multiple widgets, **each widget must declare its own domains**.

```ts
registerAppResource(server, 'Preview', PREVIEW_URI, ...);      // its own CSP
registerAppResource(server, 'Tickets List', TICKETS_URI, ...); // its own CSP
```

Do not assume a list defined for one widget automatically applies to the others.

### 3. A domain may be required for each resource type
A widget can load:
- ESM modules
- classic scripts
- CSS files
- fonts

If a resource points to a domain that is not listed, it will be blocked even if the rest of the widget works.

### 4. Rebuild required
CSP is defined on the server side in `mcp-server.ts`.

After a change:
1. `npm run build` in `mcp-server`
2. restart the MCP server
3. relaunch the session if needed

---

## Debugging

To identify a blocked domain:

1. Open Edge / Chrome DevTools in M365
2. Go to the **Network** tab, then **Console**
3. Look for errors like:
   - `Refused to load ... because it violates the following Content Security Policy directive`
4. Identify the exact domain
5. Add it to `resourceDomains`
6. rebuild and restart

---

## Full verification example

If `ui-preview-widget.html` uses:
- `@modelcontextprotocol/ext-apps/+esm`
- `@fluentui/tokens/+esm`
- Prism.js CSS/JS
- optionally Google fonts

then verify that `resourceDomains` contains at least:

```ts
[
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]
```

If the tickets widget uses only jsDelivr imports, do not over-configure it unnecessarily:

```ts
['cdn.jsdelivr.net']
```

---

## Key takeaway

Three simple rules:
- CSP blocking is often **silent**
- config is **per widget**
- after changes, a **rebuild is required**

In this project, `cdn.jsdelivr.net` is central for MCP Apps, Fluent tokens, and Prism.js, while `fonts.googleapis.com` and `fonts.gstatic.com` cover web fonts, and `unpkg.com` should still be planned for Fluent dependencies served through that CDN.
