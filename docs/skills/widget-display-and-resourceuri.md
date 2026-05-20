# Comment contrôler quel widget s'ouvre (et éviter les boucles)

## Le problème
Dans ce projet, `_meta.ui.resourceUri` dans `appPackage\ai-plugin.json` ne sert pas seulement à associer un widget à un outil : le host M365 force l'ouverture ou le rafraîchissement de cette ressource dès que l'outil est appelé.

Le piège majeur apparaît quand un widget appelle `app.callServerTool(...)` sur un outil qui possède lui-même un `resourceUri`. Le host essaie alors de rouvrir ce widget ressource, même si l'appel venait déjà d'un widget. C'est ainsi qu'on crée une boucle de réouverture.

### Symptôme
- le widget se rouvre en boucle ;
- une deuxième instance du widget apparaît ;
- l'utilisateur clique sur **Retour**, mais le widget se rouvre immédiatement ;
- un simple appel de lecture déclenche un rafraîchissement visuel non souhaité.

## La solution
### La règle d'or
Les outils appelés **depuis un widget** via `callServerTool` ne doivent **jamais** porter de `resourceUri`. Réservez `resourceUri` aux outils appelés **par le LLM depuis le chat** pour décider quel widget doit s'ouvrir.

### Pattern à appliquer dans ce projet
- `listTickets` a `resourceUri: tickets-list.html` : le chat ouvre le tableau des tickets.
- `getTicket` n'a **pas** de `resourceUri` : le widget l'utilise pour lire les données sans provoquer de réouverture.
- `generateUIFromTicket` n'a **pas** de `resourceUri` côté routage host : on laisse le widget détecter la nouvelle UI par polling au lieu de forcer la réouverture du preview.
- `generateUI` a `resourceUri: preview.html` : le chat ouvre directement le widget de preview pour une génération libre.

### Matrice des 10 outils à maintenir côté `ai-plugin.json`

| Outil | `resourceUri` | Pourquoi |
| --- | --- | --- |
| `generateUI` | Oui → `ui://uigenerator/preview.html` | Génération libre depuis le chat : le host doit ouvrir le widget de preview. |
| `updateUI` | Oui → `ui://uigenerator/preview.html` | Modification d'une UI libre depuis le chat : on garde le preview comme widget principal. |
| `listTickets` | Oui → `ui://uigenerator/tickets-list.html` | Le chat ouvre le tableau des tickets. |
| `getTicket` | Non | Lecture interne depuis un widget, restauration d'état, polling : aucune ouverture forcée ne doit se produire. |
| `generateUIFromTicket` | Non | Le résultat est enregistré sur le ticket, puis détecté par polling pour éviter de rouvrir `preview.html` en boucle. |
| `saveUIToTicket` | Non | Sauvegarde technique depuis le widget, sans changement de widget. |
| `createTicket` | Oui → `ui://uigenerator/tickets-list.html` | Après création depuis le chat, on veut réafficher le tableau mis à jour. |
| `updateTicket` | Oui → `ui://uigenerator/tickets-list.html` | Depuis le chat, le résultat naturel est un board rafraîchi. Si vous l'appelez depuis un widget, vous acceptez un refresh forcé. |
| `resetTickets` | Oui → `ui://uigenerator/tickets-list.html` | Le reset doit réouvrir un board propre immédiatement. |
| `viewTicketUI` | Oui → `ui://uigenerator/preview.html` | Depuis le chat, on veut ouvrir directement la preview d'un ticket existant. |

> Conseil pratique : gardez cette matrice cohérente entre `appPackage\ai-plugin.json` et les `_meta` déclarés dans `mcp-server\src\mcp-server.ts`, sinon le comportement du host devient difficile à raisonner.

### Pattern : utiliser le polling au lieu de `resourceUri`
Pour les outils de génération liés à un ticket, n'ouvrez pas le widget via `resourceUri`. Faites écrire le HTML sur le serveur, puis laissez le widget interroger `getTicket` toutes les 5 secondes jusqu'à ce que `uiProposal` soit disponible.

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

## Exemples
- Dans `tickets-list-widget.html`, `openPreview()` appelle volontairement `getTicket` et non `viewTicketUI` pour éviter que le host tente de rouvrir `preview.html`.
- Quand l'utilisateur clique sur **Générer l'UI** dans le board, le widget envoie un message au chat puis attend la disponibilité de `uiProposal` via `getTicket`.
- Si vous remplacez cet appel par un outil avec `resourceUri`, vous recréez le bug classique : retour impossible, double widget, ou réouverture infinie.

## Implémentation réelle côté serveur

### Ressources enregistrées avec `registerAppResource`
Les widgets ne sont pas des abstractions : ils sont déclarés explicitement avec une URI `ui://...`.

```typescript
const PREVIEW_URI = 'ui://uigenerator/preview.html';
const TICKETS_LIST_URI = 'ui://uigenerator/tickets-list.html';

registerAppResource(
  server,
  'UI Preview Widget',
  PREVIEW_URI,
  { description: 'Widget de previsualisation des interfaces generees' },
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
  { description: 'Widget de gestion des tickets et des propositions UI' },
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

### Outils avec `resourceUri` : le host doit ouvrir un widget
Extraits réels de `mcp-server\src\mcp-server.ts` :

```typescript
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
  async ({ description, htmlCode }) => {
    return {
      content: [{ type: 'text' as const, text: `Interface generee: ${description}` }],
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
    description: 'Liste les tickets du backlog avec leur statut, priorite et disponibilite d\'une proposition UI',
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
      content: [{ type: 'text' as const, text: `${summarizedTickets.length} tickets disponibles.` }],
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
    description: 'Affiche la proposition UI d\'un ticket dans le panneau de preview lateral',
    inputSchema: {
      ticketId: z.string().describe('Identifiant du ticket dont on veut voir l\'UI, par exemple US-001'),
    },
    annotations: { readOnlyHint: true },
    _meta: {
      ui: { resourceUri: PREVIEW_URI },
    },
  },
  async ({ ticketId }) => {
    const tickets = loadTickets();
    const { ticket } = findTicket(tickets, ticketId);
    const htmlCode = ticket.uiProposal || '<html><body><p>Aucune UI disponible pour ce ticket.</p></body></html>';
    return {
      content: [{ type: 'text' as const, text: `UI du ticket ${ticketId} affichee.` }],
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

Le même pattern existe aussi côté serveur pour `updateUI`, `createTicket`, `updateTicket`, `resetTickets` et, dans l'implémentation actuelle, `generateUIFromTicket`.

### Outils sans `resourceUri` : sûrs pour `callServerTool()` depuis un widget
Le code réel montre deux variantes : `_meta: {}` explicite ou absence de `resourceUri` côté plugin.

```typescript
registerAppTool(
  server,
  'getTicket',
  {
    description: 'Recupere le detail complet d\'un ticket, y compris la proposition UI si elle existe',
    inputSchema: {
      ticketId: z.string().describe('Identifiant du ticket a consulter, par exemple US-001'),
    },
    annotations: { readOnlyHint: true },
    _meta: {},
  },
  async ({ ticketId }) => {
    const tickets = loadTickets();
    const { ticket } = findTicket(tickets, ticketId);
    return {
      content: [{ type: 'text' as const, text: `Ticket ${ticketId} charge.` }],
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
    description: 'Enregistre ou remplace la proposition UI HTML/CSS/JS d\'un ticket existant',
    inputSchema: {
      ticketId: z.string().describe('Identifiant du ticket a mettre a jour, par exemple US-001'),
      htmlCode: z.string().describe('Code HTML/CSS/JS complet a enregistrer comme proposition UI'),
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
      content: [{ type: 'text' as const, text: `Proposition UI enregistree pour ${ticketId}.` }],
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

### Double déclaration dans `ai-plugin.json`
Côté plugin, les tools qui ouvrent un widget sont redéclarés avec deux formes de clé :

```json
{
  "name": "generateUI",
  "_meta": {
    "ui": { "resourceUri": "ui://uigenerator/preview.html" },
    "ui/resourceUri": "ui://uigenerator/preview.html"
  }
}
```

Même chose pour `listTickets`, `createTicket`, `updateTicket`, `resetTickets` et `viewTicketUI`. Cette redondance n'est pas cosmétique : elle sert le host M365. Quand vous changez un URI, il faut le changer **dans `mcp-server.ts` et dans `appPackage\ai-plugin.json`**.

### Pourquoi `openPreview()` utilise `getTicket`
Le code du widget l'explique littéralement :

```javascript
async function openPreview(ticketId) {
  try {
    // Use getTicket (no resourceUri) to avoid host trying to open preview.html
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
          content: [{ type: 'text', text: `L'utilisateur consulte l'UI du ticket ${ticketId} (${ticket.title || ''}). Voici le code HTML actuel de cette UI :\n\n${htmlCode}\n\nSi l'utilisateur demande des modifications, utilise ce code comme base et appelle generateUIFromTicket avec le code modifie.` }]
        });
      } catch (_) {}
      try { await app.requestDisplayMode({ mode: 'fullscreen' }); } catch (_) {}
      renderPreview();
    } else {
      setBanner(`Aucune UI disponible pour ${ticketId}.`, 'error');
    }
  } catch (e) {
    setBanner(`Erreur: ${e instanceof Error ? e.message : 'impossible'}`, 'error');
  }
}
```

### Le piège visible dans le code actuel : appeler un tool qui ouvre lui-même un widget
Le bug se comprend par contraste avec `viewTicketUI` :

```typescript
registerAppTool(
  server,
  'viewTicketUI',
  {
    description: 'Affiche la proposition UI d\'un ticket dans le panneau de preview lateral',
    inputSchema: {
      ticketId: z.string().describe('Identifiant du ticket dont on veut voir l\'UI, par exemple US-001'),
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

Si un widget remplaçait son appel sûr :

```javascript
await app.callServerTool({ name: 'getTicket', arguments: { ticketId } });
```

par un appel vers `viewTicketUI`, le host verrait `resourceUri: PREVIEW_URI` et tenterait de rouvrir `preview.html`. C'est exactement le type de boucle de réouverture que le projet évite.

### Alternative sûre réellement utilisée
Le widget tickets lit et poll toujours avec le même pattern :

```javascript
const result = await app.callServerTool({ name: 'getTicket', arguments: { ticketId } });
const data = result?.structuredContent;
const ticket = data?.ticket || data;
const htmlCode = ticket?.uiProposal;
```

Pour lancer une génération liée à un ticket, le widget ne fait pas `callServerTool('generateUIFromTicket')` ; il délègue le routage au chat, puis repoll `getTicket` :

```javascript
const prompt = `Genere l'UI du ticket ${ticketId}`;
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

C'est ce duo `sendMessage()` + `getTicket` qui évite de coupler un widget à un tool qui redemanderait au host d'ouvrir un autre widget.

