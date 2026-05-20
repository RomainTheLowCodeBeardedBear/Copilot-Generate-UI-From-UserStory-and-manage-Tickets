# Comment générer, éditer et sauvegarder une interface depuis le chat Copilot

## Le problème

Ce projet permet de créer des interfaces HTML/CSS/JS complètes directement dans le chat M365 Copilot. Mais il y a **trois façons différentes** de le faire, selon le contexte. Si on ne comprend pas quel flux utiliser, on se retrouve avec le mauvais outil appelé, des widgets qui ne s'affichent pas, ou du travail perdu au moment de sauvegarder.

Ce skill couvre le **cycle complet** : de la description en langage naturel jusqu'à l'interface rendue dans le panneau latéral, en passant par le code serveur, le routage LLM et le widget de preview.

---

## Architecture du flux de données

```
Utilisateur tape dans le chat
        │
        ▼
M365 Copilot (LLM) lit description_for_model → choisit le bon outil
        │
        ▼
Appel MCP tool sur le serveur (generateUI / updateUI / generateUIFromTicket / createTicket)
        │
        ▼
Le serveur retourne { content, structuredContent }
        │
        ▼
M365 Copilot affiche content (texte) dans le chat
        │
        ▼
Le widget reçoit structuredContent via App.ontoolresult()
        │
        ▼
Le widget rend le HTML dans une iframe sandboxée
```

**Point clé** : le LLM ne génère pas que la description — il génère aussi **le code HTML/CSS/JS complet** dans le paramètre `htmlCode`. Le serveur MCP ne fait que transiter ou stocker ce code. Toute l'intelligence de génération est dans le LLM.

---

## Les trois cas d'usage

### Cas 1 — Générer une UI à partir d'un ticket existant

**Quand :** l'utilisateur a déjà un ticket dans le backlog et veut voir à quoi l'interface pourrait ressembler.

**Flux :**

```
"Génère l'UI du ticket US-002"
        │
        ▼
  generateUIFromTicket(ticketId, htmlCode)
        │
        ▼
  Le HTML est enregistré sur le ticket (champ uiProposal)
        │
        ▼
  Le widget preview s'ouvre avec l'interface générée
```

**Ce qui se passe :**
- Le LLM lit la description du ticket, génère le HTML/CSS/JS, et appelle `generateUIFromTicket`.
- Le code est **directement sauvegardé** sur le ticket (écriture dans `tickets.json`).
- Le widget de preview s'ouvre dans le panneau latéral de Copilot.
- L'utilisateur peut demander des modifications dans le chat : « Ajoute un champ email », « Change le thème en sombre ». Le LLM rappelle `generateUIFromTicket` à chaque itération.

**Outils impliqués :** `generateUIFromTicket`

---

### Cas 2 — Créer un ticket puis générer son UI

**Quand :** l'utilisateur veut un ticket ET une interface, mais le ticket n'existe pas encore.

**Flux :**

```
"Crée un ticket pour un formulaire de contact, puis génère son interface"
        │
        ▼
  createTicket(title, description, priority)
        │
        ▼
  Le ticket apparaît dans le backlog (widget Ticket Board)
        │
        ▼
  generateUIFromTicket(ticketId, htmlCode)
        │
        ▼
  Le widget preview s'ouvre avec l'interface
```

**Ce qui se passe :**
- Le LLM crée d'abord le ticket avec `createTicket` (le Ticket Board se rafraîchit).
- Puis il enchaîne automatiquement avec `generateUIFromTicket` pour générer l'UI.
- Le résultat est le même que le Cas 1 : le HTML est sur le ticket, le preview est ouvert.

**Outils impliqués :** `createTicket` → `generateUIFromTicket`

---

### Cas 3 — Travailler sur une UI libre, sans ticket

**Quand :** l'utilisateur veut juste prototyper une interface sans créer de ticket. C'est le mode « bac à sable ».

**Flux :**

```
"Je voudrais créer une interface de remboursement de frais, thème noir, titre orange"
        │
        ▼
  generateUI(description, htmlCode)
        │
        ▼
  Le widget preview s'ouvre avec l'interface
        │
        ▼
  "Ajoute une section justificatif avec upload de fichier"
        │
        ▼
  updateUI(description, htmlCode)
        │
        ▼
  Le widget preview se met à jour
        │
        ▼
  (Optionnel) "Sauvegarde ça dans un ticket"
        │
        ▼
  createTicket(title, description, htmlCode)  ← AVEC le htmlCode !
        │
        ▼
  Le ticket est créé avec l'UI déjà enregistrée
```

**Ce qui se passe :**
- Le LLM utilise `generateUI` pour la première génération (pas de ticket, pas de sauvegarde serveur).
- Les modifications passent par `updateUI` (même logique, juste le code mis à jour).
- Le widget preview s'ouvre et se met à jour à chaque itération.
- **Point critique :** quand l'utilisateur veut sauvegarder, le LLM doit appeler `createTicket` **avec le paramètre `htmlCode`** contenant le dernier HTML de la conversation. Sans ça, le ticket est créé vide et tout le travail est perdu.

**Outils impliqués :** `generateUI` → `updateUI` (×N) → `createTicket` avec `htmlCode`

---

## Implémentation côté serveur (MCP tools)

Les outils de génération d'UI sont enregistrés dans `mcp-server/src/mcp-server.ts` avec `registerAppTool` du package `@modelcontextprotocol/ext-apps/server`.

### generateUI — génération libre (Cas 3)

```typescript
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';

const PREVIEW_URI = 'ui://uigenerator/preview.html';

registerAppTool(
  server,
  'generateUI',
  {
    description: 'Genere une interface HTML/CSS/JS complete a partir d\'une description',
    inputSchema: {
      description: z.string().describe('Description de l\'interface generee'),
      htmlCode: z.string().describe('Code HTML/CSS/JS complet auto-contenu'),
    },
    // _meta.ui.resourceUri → dit au host M365 d'ouvrir le widget preview.html
    _meta: { ui: { resourceUri: PREVIEW_URI } },
  },
  async ({ description, htmlCode }) => {
    // Pas de sauvegarde serveur ! Le HTML transite juste vers le widget.
    return {
      content: [{ type: 'text' as const, text: `Interface generee: ${description}` }],
      structuredContent: {
        type: 'generate',       // le widget utilise ce champ pour le badge "Généré"
        description,
        htmlCode,               // ← le code complet passe dans structuredContent
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

**Points importants :**
- `_meta.ui.resourceUri: PREVIEW_URI` → indique au host M365 Copilot d'ouvrir le widget `ui-preview-widget.html` quand cet outil retourne un résultat.
- `structuredContent.htmlCode` → c'est ce que le widget reçoit via `App.ontoolresult()`.
- **Pas de sauvegarde fichier** : le HTML est uniquement dans la réponse. Si l'utilisateur recharge la page, c'est perdu (c'est voulu — mode bac à sable).

### updateUI — modification itérative (Cas 3)

```typescript
registerAppTool(
  server,
  'updateUI',
  {
    description: 'Met a jour l\'interface existante avec les modifications demandees',
    inputSchema: {
      description: z.string().describe('Description des modifications apportees'),
      htmlCode: z.string().describe('Code HTML/CSS/JS complet mis a jour'),
    },
    _meta: { ui: { resourceUri: PREVIEW_URI } },
  },
  async ({ description, htmlCode }) => {
    return {
      content: [{ type: 'text' as const, text: `Interface mise a jour: ${description}` }],
      structuredContent: {
        type: 'update',         // le widget affiche "Mis à jour" au lieu de "Généré"
        description,
        htmlCode,
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

**Identique à `generateUI`** sauf `type: 'update'` dans `structuredContent`. Le widget affiche un badge différent mais le rendu est le même.

### generateUIFromTicket — génération liée à un ticket (Cas 1 et 2)

```typescript
registerAppTool(
  server,
  'generateUIFromTicket',
  {
    description: 'Genere une interface HTML/CSS/JS a partir de la description d\'un ticket puis enregistre la proposition UI sur ce ticket',
    inputSchema: {
      ticketId: z.string().describe('Identifiant du ticket (ex: US-001)'),
      htmlCode: z.string().describe('Code HTML/CSS/JS complet genere'),
    },
    _meta: { ui: { resourceUri: PREVIEW_URI } },
  },
  async ({ ticketId, htmlCode }) => {
    // Sauvegarde côté serveur → le ticket est mis à jour
    const tickets = loadTickets();
    const { ticket, index } = findTicket(tickets, ticketId);
    const updatedTicket: Ticket = { ...ticket, uiProposal: htmlCode };
    tickets[index] = updatedTicket;
    saveTickets(tickets);

    return {
      content: [{ type: 'text' as const, text: `Proposition UI generee et enregistree pour ${ticketId}.` }],
      structuredContent: {
        type: 'generate',
        ticketId,
        title: updatedTicket.title,
        description: updatedTicket.description,
        htmlCode,
        ticket: updatedTicket,   // le ticket complet pour info
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

**Différence clé avec `generateUI`** : ici le HTML est **écrit dans `tickets.json`** (champ `uiProposal`). Le widget Ticket Board peut ensuite détecter que le ticket a une UI (bouton "Voir & Éditer l'UI" vs "Générer l'UI").

### createTicket avec htmlCode — sauvegarde d'une UI libre (Cas 3 → ticket)

```typescript
registerAppTool(
  server,
  'createTicket',
  {
    description: 'Cree un nouveau ticket dans le backlog UI. Si htmlCode est fourni, enregistre aussi la proposition UI directement.',
    inputSchema: {
      title: z.string(),
      description: z.string(),
      priority: z.enum(['High', 'Medium', 'Low']).optional(),
      assignee: z.string().optional(),
      htmlCode: z.string().optional(),  // ← OPTIONNEL mais crucial pour le Cas 3
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
      assignee: assignee ?? 'Non assigne',
      uiProposal: htmlCode || null,    // ← Si htmlCode fourni, l'UI est sur le ticket
    };
    tickets.push(newTicket);
    saveTickets(tickets);

    return {
      content: [{ type: 'text' as const, text: `Ticket ${newId} cree: ${title}` }],
      structuredContent: {
        tickets: summarizeTickets(tickets),  // la liste complète pour le Ticket Board
        createdTicketId: newId,
        timestamp: new Date().toISOString(),
      },
    };
  },
);
```

**Le paramètre `htmlCode` est optionnel mais vital.** Quand il est fourni, le ticket est créé avec l'UI déjà en place. Quand il est absent, le ticket est créé sans UI et le travail de la conversation est perdu.

---

## Implémentation côté widget (ui-preview-widget.html)

Le widget de preview est le fichier `mcp-server/assets/ui-preview-widget.html`. C'est un fichier HTML autonome qui tourne dans une iframe sandboxée dans M365 Copilot.

### Enregistrement comme ressource MCP

```typescript
const previewWidgetHtml = readFileSync(join(__dirname, '../assets/ui-preview-widget.html'), 'utf8');
const PREVIEW_URI = 'ui://uigenerator/preview.html';

registerAppResource(
  server,
  'UI Preview Widget',
  PREVIEW_URI,
  { description: 'Widget de previsualisation des interfaces generees' },
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

**Points importants :**
- `RESOURCE_MIME_TYPE` = `'application/vnd.mcp.ext-apps.widget+html'` → indique à M365 que c'est un widget HTML.
- `csp.resourceDomains` → liste blanche des CDN autorisés dans l'iframe (voir skill [mcp-app-csp-resources.md](mcp-app-csp-resources.md)).
- Le widget est lu au démarrage du serveur et servi tel quel.

### Réception des données dans le widget

Le widget utilise le SDK `@modelcontextprotocol/ext-apps` côté client :

```javascript
import { App } from 'https://cdn.jsdelivr.net/npm/@modelcontextprotocol/ext-apps/+esm';

const app = new App({ name: 'ui-preview', version: '1.0.0' });

app.ontoolresult = (result) => {
  // ⚠️ Les données sont TOUJOURS dans result.structuredContent
  // PAS dans result.data, PAS dans result.content, PAS dans result directement
  const data = result.structuredContent;

  if (data && data.htmlCode) {
    showPreview(data.htmlCode, data.description || '', data.type || 'generate');
  } else {
    showError('Aucun code HTML recu.');
  }
};

await app.connect();
```

**Piège classique** : `result.structuredContent` et non `result.data`. C'est la source d'erreur n°1 quand on crée un nouveau widget.

### Injection du HTML dans l'iframe de preview

```javascript
function showPreview(htmlCode, description, type) {
  currentHtmlCode = htmlCode;

  // Injection directe dans l'iframe — le HTML généré par le LLM devient une page complète
  const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
  doc.open();
  doc.write(htmlCode);
  doc.close();

  // Badge "Généré" ou "Mis à jour"
  statusBadge.textContent = type === 'update' ? 'Mis a jour' : 'Genere';
  infoBar.textContent = description;

  // Auto-ouverture en plein écran à la première génération
  if (!isFullscreen) {
    isFullscreen = true;
    try { app.requestDisplayMode({ mode: 'fullscreen' }); } catch (_) {}
  }
}
```

**Pourquoi `doc.open/write/close` ?** Parce que le HTML généré par le LLM est un document HTML **complet** (avec `<!DOCTYPE>`, `<html>`, `<style>`, `<script>`...). On ne peut pas juste mettre `innerHTML` — il faut écraser tout le document de l'iframe.

### Vue Code / Aperçu (toggle)

Le widget a deux modes d'affichage : le rendu visuel (iframe) et le code source (PrismJS) :

```javascript
let showingCode = false;

btnToggle.addEventListener('click', () => {
  showingCode = !showingCode;
  if (showingCode) {
    previewEl.style.display = 'none';
    codeView.style.display = 'block';
    codeContent.textContent = currentHtmlCode;   // code brut dans un <code>
    Prism.highlightElement(codeContent);           // coloration syntaxique
    // Le bouton passe de "Code" à "Aperçu"
  } else {
    previewEl.style.display = 'block';
    codeView.style.display = 'none';
    // Le bouton repasse à "Code"
  }
});
```

**Librairies utilisées :**
- [PrismJS](https://prismjs.com/) pour la coloration syntaxique (thème `prism-tomorrow` = fond sombre)
- Plugin `line-numbers` pour les numéros de ligne
- Chargées via CDN (déclarées dans `csp.resourceDomains`)

### Bouton Copier

```javascript
btnCopy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(currentHtmlCode);
  btnCopy.textContent = 'Copié !';
  setTimeout(() => { btnCopy.textContent = 'Copier'; }, 1500);
});
```

### Plein écran et retour

```javascript
// Ouvrir en plein écran (API MCP Apps)
btnOpen.addEventListener('click', async () => {
  await app.requestDisplayMode({ mode: 'fullscreen' });
  isFullscreen = true;
});

// Retour au mode inline (panneau latéral)
btnBack.addEventListener('click', async () => {
  await app.requestDisplayMode({ mode: 'inline' });
  isFullscreen = false;
});
```

**Comportement auto-fullscreen** : à la première réception de données (`showPreview`), le widget passe automatiquement en plein écran. Ça donne une meilleure expérience car l'interface générée est trop petite en panneau latéral (~400px).

---

## Routage LLM — comment le bon outil est choisi

### description_for_model (ai-plugin.json)

Le champ le plus important du projet. C'est un **bloc de texte unique** que le LLM lit comme une consigne. Il contient les règles de routage entre les 3 cas :

```json
{
  "description_for_model": "Plugin de gestion de tickets UI et generation d'interfaces web. TROIS CAS D'USAGE: CAS 1 - UI depuis un ticket existant: utiliser generateUIFromTicket pour generer ou modifier l'UI d'un ticket existant. CAS 2 - Creer un ticket puis son UI: d'abord createTicket, puis generateUIFromTicket. CAS 3 - UI libre SANS ticket: quand l'utilisateur veut juste une interface sans parler de ticket, utiliser generateUI pour creer et updateUI pour modifier. [...] IMPORTANT: quand l'utilisateur demande de creer un ticket apres avoir travaille sur une UI libre, TOUJOURS inclure le htmlCode dans createTicket pour ne pas perdre le travail."
}
```

**Techniques qui marchent :**
- Mots-clés en **MAJUSCULES** : `TOUJOURS`, `JAMAIS`, `IMPORTANT`, `REGLE`
- Numérotation des cas : `CAS 1`, `CAS 2`, `CAS 3`
- Règles absolues au lieu de suggestions molles : « TOUJOURS inclure » vs « peut inclure »
- Répéter la même règle dans `description_for_model` ET dans `instruction.txt`

### instruction.txt (prompt système de l'agent)

Le fichier `appPackage/instruction.txt` est le prompt système envoyé au LLM. Il renforce les règles de routage et ajoute les consignes de génération HTML :

```
## Regles de generation
- Design moderne, propre et responsive
- CSS integre dans un bloc <style>
- Code auto-contenu dans un seul fichier HTML
- Pas de dependances externes sauf si demande

## Workflow
### Generation libre
1. Si l'utilisateur decrit une UI sans ticket → generateUI
2. Pour modifier l'UI courante → updateUI (code HTML complet, pas juste le diff)

### Workflow tickets
1. "genere l'UI du ticket US-001" → generateUIFromTicket
2. Pour sauvegarder une UI libre → createTicket avec htmlCode
```

---

## Le schéma des tickets

Chaque ticket est stocké dans `mcp-server/data/tickets.json` :

```typescript
type Ticket = {
  id: string;            // "US-001", "US-002"...
  title: string;         // Titre court
  description: string;   // Description fonctionnelle détaillée (user story)
  priority: 'High' | 'Medium' | 'Low';
  status: 'To Do' | 'In Progress' | 'Done';
  assignee: string;      // Nom ou "Non assigné"
  uiProposal: string | null;  // ← Le code HTML/CSS/JS complet, ou null
};
```

**Le champ `uiProposal`** est la clé : c'est là que le HTML est stocké quand on utilise `generateUIFromTicket` ou `createTicket` avec `htmlCode`. Le widget Ticket Board utilise ce champ pour afficher soit "Générer l'UI" (si null) soit "Voir & Éditer l'UI" (si rempli).

---

## Résumé des structuredContent par outil

Chaque outil retourne un format de `structuredContent` différent. Le widget doit savoir quoi en faire :

### generateUI / updateUI

```json
{
  "type": "generate",       // ou "update"
  "description": "Description de l'interface",
  "htmlCode": "<!DOCTYPE html>...",
  "timestamp": "2026-05-20T..."
}
```

→ Le widget lit `data.htmlCode` et l'injecte dans l'iframe.

### generateUIFromTicket

```json
{
  "type": "generate",
  "ticketId": "US-002",
  "title": "Landing Page Hero Section",
  "description": "As a visitor, I want a hero section...",
  "htmlCode": "<!DOCTYPE html>...",
  "ticket": { /* ticket complet */ },
  "timestamp": "2026-05-20T..."
}
```

→ Même traitement côté widget (`data.htmlCode` → iframe). La différence est côté serveur (sauvegarde dans `tickets.json`).

### createTicket (avec ou sans htmlCode)

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

→ Ce format est consommé par le **Ticket Board** (pas le preview). Le champ `hasUiProposal` (boolean) détermine quel bouton afficher par ticket.

---

## Différences techniques entre les outils (tableau récapitulatif)

| Outil | Sauvegarde serveur | `resourceUri` | Widget ouvert | `structuredContent.htmlCode` |
|-------|-------------------|---------------|---------------|------------------------------|
| `generateUI` | Non | `preview.html` | Preview | Oui |
| `updateUI` | Non | `preview.html` | Preview | Oui |
| `generateUIFromTicket` | Oui (`uiProposal`) | `preview.html` | Preview | Oui |
| `createTicket` avec `htmlCode` | Oui (ticket + UI) | `tickets-list.html` | Ticket Board | Non (liste de tickets) |
| `createTicket` sans `htmlCode` | Oui (ticket seul) | `tickets-list.html` | Ticket Board | Non |
| `saveUIToTicket` | Oui (`uiProposal`) | — | Aucun | Non |

---

## Exemples de prompts et résultat attendu

| Prompt utilisateur | Cas | Outils appelés |
|---|---|---|
| « Génère l'UI du ticket US-001 » | 1 | `generateUIFromTicket` |
| « Modifie l'interface du US-002 : ajoute un mode sombre » | 1 | `generateUIFromTicket` |
| « Crée un ticket pour un dashboard RH et génère son UI » | 2 | `createTicket` → `generateUIFromTicket` |
| « Je veux une interface de remboursement de frais » | 3 | `generateUI` |
| « Ajoute un champ date et un sélecteur de devise » | 3 | `updateUI` |
| « Sauvegarde cette interface dans un ticket » | 3→ticket | `createTicket` avec `htmlCode` |

---

## Le piège classique : perdre le travail en sauvegardant

Le problème le plus fréquent arrive dans le **Cas 3** quand l'utilisateur a passé plusieurs itérations à peaufiner une UI libre, puis demande « crée un ticket avec ça ».

Si le LLM appelle `createTicket` **sans** le paramètre `htmlCode`, le ticket est créé mais **l'UI n'est pas enregistrée**. Tout le travail de la conversation est perdu.

**La solution :** le `description_for_model` contient une règle explicite :

> *IMPORTANT: quand l'utilisateur demande de créer un ticket après avoir travaillé sur une UI libre, TOUJOURS inclure le htmlCode dans createTicket pour ne pas perdre le travail.*

Si malgré ça le LLM oublie le `htmlCode`, il faut renforcer la règle dans `instruction.txt` avec des formulations absolues (`TOUJOURS`, `JAMAIS`). Voir [llm-tool-routing.md](llm-tool-routing.md) pour les techniques de renforcement.

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `mcp-server/src/mcp-server.ts` | Enregistrement de tous les tools MCP et resources |
| `mcp-server/assets/ui-preview-widget.html` | Widget de preview (iframe + code + fullscreen) |
| `mcp-server/assets/tickets-list-widget.html` | Widget Ticket Board |
| `mcp-server/data/tickets.json` | Données des tickets (runtime, modifiable) |
| `mcp-server/data/tickets-default.json` | Données initiales (reset demo) |
| `appPackage/ai-plugin.json` | Routage LLM (`description_for_model`) + schémas des tools |
| `appPackage/instruction.txt` | Prompt système de l'agent (règles de génération HTML) |

---

## Pour ajouter un nouvel outil de génération d'UI

Si tu veux ajouter un nouveau type de génération (par ex. `generateUIFromTemplate`), voici le pattern :

1. **Enregistrer le tool** dans `mcp-server.ts` avec `registerAppTool` :
   - `inputSchema` avec `z.string()` pour les paramètres
   - `_meta: { ui: { resourceUri: PREVIEW_URI } }` pour ouvrir le preview
   - Retourner `structuredContent` avec `htmlCode`

2. **Ajouter la déclaration** dans `ai-plugin.json` :
   - Section `functions[]` pour la description courte
   - Section `runtimes[0].spec.x-mcp_tool_description.tools[]` pour le schéma complet
   - Section `run_for_functions[]` pour l'activer

3. **Mettre à jour `description_for_model`** pour que le LLM sache quand utiliser ce nouvel outil

4. **Le widget n'a pas besoin de changer** tant que le `structuredContent` contient `htmlCode` — il le rend automatiquement.

---

## Skills liés

- [llm-tool-routing.md](llm-tool-routing.md) — Comment configurer `description_for_model` pour que le LLM choisisse le bon outil
- [widget-display-and-resourceuri.md](widget-display-and-resourceuri.md) — Comment `resourceUri` contrôle quel widget s'ouvre
- [widget-realtime-updates.md](widget-realtime-updates.md) — Comment le preview se met à jour automatiquement pendant que le LLM travaille
- [widget-fullscreen-and-state.md](widget-fullscreen-and-state.md) — Comment le plein écran préserve l'état du widget
- [mcp-app-csp-resources.md](mcp-app-csp-resources.md) — Comment débloquer les CDN dans les iframes M365
