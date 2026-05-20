# Comment mettre à jour un widget en temps réel pendant que l'IA travaille

## Le problème
Dans ce projet, l'utilisateur peut demander une modification d'UI alors que la preview est déjà ouverte en plein écran. Le LLM répond dans le chat, appelle `generateUIFromTicket`, et enregistre le nouveau HTML sur le serveur. Pourtant, le widget de preview continue souvent d'afficher l'ancien rendu.

La cause est simple : l'iframe du widget ne reçoit aucune notification push quand les données du ticket changent côté serveur.

## La solution
La solution retenue est un polling léger avec détection de changement. Le widget relit périodiquement `getTicket` et compare la nouvelle valeur de `uiProposal` avec la dernière version connue.

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
  }, 5000); // toutes les 5 secondes
}
```

### Deux usages du polling dans ce projet
1. **Polling "Générer"** : après un clic sur **Générer l'UI** dans le board, le widget envoie un message au chat puis interroge `getTicket` toutes les 5 secondes jusqu'à ce que `uiProposal` passe de `null` à un HTML complet. Dès que c'est prêt, il ouvre automatiquement la preview en plein écran.
2. **Polling "Preview"** : pendant que la preview est ouverte, le widget continue d'interroger `getTicket` toutes les 5 secondes. Si `uiProposal` change parce que l'utilisateur a demandé une modification dans le chat, l'iframe est mise à jour immédiatement via `srcdoc`.

### Règle importante
Toujours nettoyer les timers quand on quitte le mode concerné.

```javascript
clearInterval(pollId);
```

Sans ce nettoyage, vous cumulez des requêtes inutiles, des mises à jour fantômes et des états incohérents.

### Limitation assumée
Un polling toutes les 5 secondes introduit un petit délai entre la fin réelle du travail du LLM et l'actualisation visuelle. Pour une démo, c'est acceptable. Pour un produit plus exigeant, il faudrait un mécanisme push ou événementiel.

## Exemples
- Dans `tickets-list-widget.html`, `handleTicketAction()` démarre un polling après `app.sendMessage(...)` pour détecter la fin de génération.
- Dans `renderPreview()`, le widget démarre un autre polling pour surveiller les modifications de `uiProposal` pendant que la preview est affichée.
- Quand l'utilisateur revient au board, le code appelle `clearInterval(...)` avant de remettre l'état de preview à `null`.

## Implémentation réelle dans `tickets-list-widget.html`

### Polling de preview pendant l'affichage
Le code réel ne fait pas un polling abstrait : il gère le timer global, le garde-fou de sortie et la réinjection du contexte LLM.

```javascript
function renderPreview() {
  const mainView = document.getElementById('main-view');
  const previewView = document.getElementById('preview-view');
  mainView.style.display = 'none';
  previewView.style.display = 'flex';
  previewView.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid var(--colorNeutralStroke2,#e5e7eb);background:var(--colorNeutralBackground1,#fff);">
      <button id="btn-back-preview" style="background:none;border:1px solid var(--colorNeutralStroke1,#d1d5db);border-radius:8px;padding:6px 14px;cursor:pointer;font-size:13px;color:inherit;">← Retour</button>
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
          // Re-inject updated context so LLM always has the latest version
          try {
            await app.updateModelContext({
              content: [{ type: 'text', text: `L'utilisateur consulte l'UI du ticket ${ticketId} (${state.previewTitle || ''}). Voici le code HTML actuel de cette UI :\n\n${t.uiProposal}\n\nSi l'utilisateur demande des modifications, utilise ce code comme base et appelle generateUIFromTicket avec le code modifie.` }]
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

### Polling de génération après `app.sendMessage()`
Le widget ne lance pas `generateUIFromTicket` directement. Il demande au chat de le faire, puis attend l'apparition de `uiProposal` avec un maximum de 24 tentatives.

```javascript
if (action === 'generate') {
  const prompt = `Genere l'UI du ticket ${ticketId}`;
  setBanner(`Envoi de la demande...`, 'info');

  try {
    await app.sendMessage({ role: 'user', content: [{ type: 'text', text: prompt }] });
  } catch (e) {
    setBanner(`💡 Ecrivez dans le chat : "${prompt}"`, 'info');
    return;
  }

  // Poll for generation completion then auto-open preview
  setBanner(`⏳ Generation en cours...`, 'info');
  let attempts = 0;
  const pollId = setInterval(async () => {
    attempts++;
    if (attempts > 24) {
      clearInterval(pollId);
      setBanner(`Generation terminee. Cliquez "Voir & Editer l'UI" pour voir le resultat.`, 'info');
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

### Réinjection du HTML courant dans le contexte du modèle
Le pattern clé n'est pas juste le polling, mais le **polling + `updateModelContext()`**. Deux points réels le montrent :

```javascript
await app.updateModelContext({
  content: [{ type: 'text', text: `L'utilisateur consulte l'UI du ticket ${ticketId} (${ticket.title || ''}). Voici le code HTML actuel de cette UI :\n\n${htmlCode}\n\nSi l'utilisateur demande des modifications, utilise ce code comme base et appelle generateUIFromTicket avec le code modifie.` }]
});
```

Puis pendant le polling, le widget remplace ce contexte par la version fraîche :

```javascript
await app.updateModelContext({
  content: [{ type: 'text', text: `L'utilisateur consulte l'UI du ticket ${ticketId} (${state.previewTitle || ''}). Voici le code HTML actuel de cette UI :\n\n${t.uiProposal}\n\nSi l'utilisateur demande des modifications, utilise ce code comme base et appelle generateUIFromTicket avec le code modifie.` }]
});
```

Sans cette réinjection, l'IA peut repartir d'une ancienne version du HTML alors que l'iframe montre déjà autre chose.

### Pattern d'état réel à respecter
Le timer de preview est stocké dans l'état du widget lui-même :

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

Les trois détails importants sont déjà codés :
- `state.previewPollId` centralise le timer actif ;
- le garde-fou `if (!state.previewTicketId) { clearInterval(...); ... return; }` arrête le polling si on a quitté la preview ;
- le bouton retour remet **tout** à `null` avant de repasser inline.

### Pourquoi `getTicket` et pas `viewTicketUI`
Le choix est explicitement documenté dans le code :

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

`getTicket` est le safe read-model pour les widgets. `viewTicketUI` est réservé au routing du host depuis le chat, précisément parce qu'il ouvre une ressource.

### Déclencher une génération depuis le widget
Le pattern réel côté widget est : **écrire dans le chat**, pas appeler l'outil de génération directement.

```javascript
const prompt = `Genere l'UI du ticket ${ticketId}`;
await app.sendMessage({ role: 'user', content: [{ type: 'text', text: prompt }] });
```

Ce pattern laisse le LLM faire le routage normal (`generateUIFromTicket`) et garde le widget dans un rôle d'orchestration légère.

### `srcdoc` dans le board vs `doc.open()/write()/close()` dans la preview libre
Les deux widgets n'injectent pas le HTML de la même façon.

Dans `tickets-list-widget.html`, la preview embarquée met à jour une iframe déjà créée :

```javascript
const frame = document.getElementById('preview-frame');
if (frame) { frame.srcdoc = state.previewHtml; }

const f = document.getElementById('preview-frame');
if (f) { f.srcdoc = t.uiProposal; }
```

Dans `ui-preview-widget.html`, le widget de preview libre réécrit complètement le document de l'iframe à chaque résultat d'outil :

```javascript
const doc = previewFrame.contentDocument || previewFrame.contentWindow.document;
doc.open();
doc.write(htmlCode);
doc.close();
```

Utiliser `srcdoc` est pratique pour une iframe déjà montée dans un widget qui reste maître de son état. Utiliser `doc.write(...)` correspond mieux au widget de preview qui reçoit directement `structuredContent.htmlCode` via `app.ontoolresult`.

