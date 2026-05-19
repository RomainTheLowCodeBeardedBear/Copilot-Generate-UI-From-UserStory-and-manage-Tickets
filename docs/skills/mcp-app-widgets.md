# Skill : MCP App Widgets - patterns et pièges

> Référence adaptée pour le **projet UI Generator**. Cette skill documente les bons patterns pour construire des widgets HTML utilisés par les tools MCP du projet.

---

## Principe

Un widget MCP App est un fichier HTML autonome rendu dans une iframe sandboxée dans M365 Copilot. Il reçoit les données du tool via `App` puis met à jour son DOM.

```
Tool résultat (structuredContent)
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

Dans ce projet, les deux widgets principaux sont :
- `mcp-server/assets/tickets-list-widget.html`
- `mcp-server/assets/ui-preview-widget.html`

---

## 1. Template HTML de base

```html
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Libs externes AVANT le module si elles exposent des globals -->
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"></script>

  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--fontFamilyBase, 'Segoe UI', sans-serif);
    }
  </style>
  <!-- ⚠️ </style> OBLIGATOIRE -->
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

## 2. ⚠️ Piège critique : balise `</style>` manquante

**Symptôme** : widget vide, panneau gris, aucun DOM visible.

**Cause** : si `</style>` manque, tout ce qui suit est interprété comme du CSS.

**Règle** : à chaque modification d'un bloc `<style>`, vérifier que le `</style>` final est bien présent.

```html
<!-- ✅ correct -->
<style>
  .card { padding: 12px; }
</style>

<!-- ❌ cassé -->
<style>
  .card { padding: 12px; }
<div>ce div ne sera jamais créé</div>
```

C'est un piège classique sur les widgets HTML édités par IA.

---

## 3. `registerAppTool` vs `registerTool`

| | `server.registerTool` | `registerAppTool` |
|---|---|---|
| Import | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/ext-apps/server` |
| Widget HTML | ❌ Non | ✅ Oui |
| Usage | Tool texte pur | Tool avec rendu visuel |

### Tool sans widget

```ts
server.registerTool('getTicket', {
  description: 'Recupere le detail complet d\'un ticket',
  inputSchema: { ticketId: z.string() },
}, async ({ ticketId }) => ({
  content: [{ type: 'text', text: `Ticket ${ticketId} charge.` }],
  structuredContent: { ticketId }
}));
```

### Tool avec widget

```ts
registerAppTool(
  server,
  'listTickets',
  {
    description: 'Liste les tickets du backlog UI',
    inputSchema: {},
    _meta: { ui: { resourceUri: 'ui://uigenerator/tickets-list.html' } }
  },
  async () => ({
    content: [{ type: 'text', text: 'Tickets charges.' }],
    structuredContent: {
      type: 'ticketList',
      tickets,
      total: tickets.length,
    }
  })
);
```

### Resource widget

```ts
registerAppResource(
  server,
  'UI Preview Widget',
  'ui://uigenerator/preview.html',
  { description: 'Widget de preview UI' },
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

## 4. Pattern état + re-render sans framework

Un widget MCP App passe souvent par plusieurs états : loading, erreur, succès, édition.

```js
let currentData = null;
let isLoading = false;
let lastError = null;

function renderScreen() {
  if (isLoading) {
    root.innerHTML = `<div>Chargement...</div>`;
    return;
  }

  if (lastError) {
    root.innerHTML = `<div style="color:red">${escapeHtml(lastError)}</div>`;
    return;
  }

  root.innerHTML = buildHtml(currentData);

  // ⚠️ Ré-attacher les listeners après chaque innerHTML
  root.querySelector('[data-action="refresh"]')?.addEventListener('click', handleRefresh);
}
```

Dans ce projet :
- `ui-preview-widget.html` gère `loading`, `preview`, `code view`, `error`
- `tickets-list-widget.html` gère `loading`, `list`, `banner`, `preview`, `edit form`

---

## 5. Event delegation - alternative robuste

Quand le DOM est régénéré souvent, la délégation d'événements est plus robuste que de rattacher tous les listeners après chaque `innerHTML`.

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

Le widget tickets du projet attache ses listeners après rendu, mais ce pattern de délégation reste utile dès que le widget devient plus complexe.

---

## 6. `structuredContent` - ce que le widget reçoit vraiment

**Règle absolue :** les données applicatives sont dans **`result.structuredContent`**.

```js
app.ontoolresult = (result) => {
  const data = result.structuredContent;
  if (!data) return;
  render(data);
};
```

**Ne pas faire :**
```js
result.data      // ❌ undefined
result.content   // ❌ résumé texte pour le LLM, pas vos données métier
result           // ❌ objet MCP brut
```

### Exemples du projet

#### Résultat de `listTickets`
```js
{
  type: 'ticketList',
  tickets: [...],
  total: 3,
  timestamp: '...'
}
```

#### Résultat de `generateUI` / `updateUI`
```js
{
  type: 'generate',
  description: 'Landing page moderne',
  htmlCode: '<!DOCTYPE html>...',
  timestamp: '...'
}
```

#### Résultat de `generateUIFromTicket`
```js
{
  type: 'generate',
  ticketId: 'US-001',
  title: 'Accueil dashboard',
  description: '...',
  htmlCode: '<!DOCTYPE html>...',
  ticket: { ... },
  timestamp: '...'
}
```

---

## 7. `callServerTool` - rappeler le serveur depuis le widget

Dans ce projet, les widgets rappellent le serveur avec la forme objet suivante :

```js
const result = await app.callServerTool({
  name: 'getTicket',
  arguments: { ticketId: 'US-001' }
});

const data = result?.structuredContent;
```

### Exemples réels utiles

#### Rafraîchir la liste des tickets
```js
await app.callServerTool({
  name: 'listTickets',
  arguments: {}
});
```

#### Réinitialiser la démo
```js
await app.callServerTool({
  name: 'resetTickets',
  arguments: {}
});
```

#### Sauvegarder une UI sur un ticket
```js
await app.callServerTool({
  name: 'saveUIToTicket',
  arguments: {
    ticketId: 'US-001',
    htmlCode: currentHtml
  }
});
```

#### Charger un ticket avant preview
```js
const result = await app.callServerTool({
  name: 'getTicket',
  arguments: { ticketId }
});
const ticket = result?.structuredContent?.ticket || result?.structuredContent;
```

---

## 8. Bibliothèques externes dans les widgets

Règle :
1. déclarer les domaines dans `resourceDomains`
2. charger les scripts globaux avant le module
3. importer en ESM uniquement ce qui expose réellement un export ESM

### Exemple Prism.js dans `ui-preview-widget.html`

```html
<link href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"></script>

<script type="module">
  // Prism est global, accessible via window/nom global
  Prism.highlightElement(codeContent);
</script>
```

### Exemple Fluent dans `tickets-list-widget.html`

```js
import { provideFluentDesignSystem, fluentButton } from 'https://cdn.jsdelivr.net/npm/@fluentui/web-components@2.6.1/+esm';
import { webLightTheme, webDarkTheme } from 'https://cdn.jsdelivr.net/npm/@fluentui/tokens/+esm';

provideFluentDesignSystem().register(fluentButton());
```

---

## 9. `escapeHtml` - obligatoire avant `innerHTML`

Toute donnée injectée dans du HTML doit être échappée.

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

### Exemples du projet

```js
<h2 class="ticket-title">${escapeHtml(ticket.title)}</h2>
<span class="ticket-id">${escapeHtml(ticket.id)}</span>
<p class="desc-short">${escapeHtml(short)}</p>
```

Sans ça, un titre de ticket ou une description peut casser le DOM ou injecter du contenu non désiré.

---

## 10. Widgets du projet UI Generator

### `tickets-list-widget.html`
À utiliser pour :
- `listTickets`
- `createTicket`
- `updateTicket`
- `resetTickets`

Patterns intéressants :
- affichage backlog + résumé KPI
- formulaires inline d'édition
- appels `callServerTool()` pour relire / mettre à jour les tickets
- `app.sendMessage()` pour demander la génération d'UI depuis un ticket
- preview plein écran avec restauration d'état via `localStorage`

### `ui-preview-widget.html`
À utiliser pour :
- `generateUI`
- `updateUI`
- `generateUIFromTicket`
- `viewTicketUI`

Patterns intéressants :
- iframe `srcdoc` pour injecter le HTML généré
- bascule aperçu / code
- mise en évidence du code avec Prism.js
- copy-to-clipboard
- `requestDisplayMode()` pour inline / fullscreen

---

## Checklist rapide

- `registerAppTool` pour tout tool avec widget
- `registerAppResource` pour chaque HTML autonome
- `result.structuredContent` uniquement
- `</style>` toujours fermé
- `escapeHtml()` avant `innerHTML`
- rebind des events après rendu, ou event delegation
- `callServerTool()` pour rappeler le serveur
- domaines CDN autorisés dans `resourceDomains`

---

## À retenir

Les deux causes de panne les plus fréquentes sont :
1. un widget qui lit autre chose que `result.structuredContent`
2. un HTML cassé à cause d'un `</style>` manquant

Le reste relève surtout d'un bon pattern de rendu et d'un câblage propre entre `registerAppTool`, `registerAppResource` et `callServerTool()`.