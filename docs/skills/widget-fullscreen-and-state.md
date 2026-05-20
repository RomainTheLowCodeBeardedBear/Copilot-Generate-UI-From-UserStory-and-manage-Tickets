# Comment gérer le plein écran sans perdre l'état du widget

## Le problème
Dans ce projet, `app.requestDisplayMode({ mode: 'fullscreen' })` ne réutilise pas l'iframe courante. Le host crée une **nouvelle iframe**. Toute la mémoire JavaScript est donc perdue : variables, écouteurs d'événements, timers, références DOM, tout repart à zéro.

### Symptôme
L'utilisateur clique sur le bouton plein écran, mais le widget affiche son état initial ou son écran de chargement au lieu du contenu attendu.

## La solution
La bonne solution est de sauvegarder **l'état minimal restaurable** dans `localStorage`, avec une expiration très courte.

```javascript
// Avant le passage en plein écran : sauver le ticketId
localStorage.setItem('preview_ticket', JSON.stringify({
  id: ticketId,
  ts: Date.now()
}));
app.requestDisplayMode({ mode: 'fullscreen' });

// Au démarrage : relire localStorage
const saved = JSON.parse(localStorage.getItem('preview_ticket') || 'null');
if (saved && Date.now() - saved.ts < 10000) { // expiration 10 s
  localStorage.removeItem('preview_ticket');
  // Restaurer l'état à partir de saved.id
  const result = await app.callServerTool({
    name: 'getTicket',
    arguments: { ticketId: saved.id }
  });
  // Refaire le rendu avec les données restaurées
}
```

### Pourquoi 10 secondes d'expiration
Le but n'est pas de persister un état métier durable. On veut seulement survivre au temps nécessaire pour que l'iframe fullscreen se recrée et relise la valeur. Dix secondes suffisent largement pour ce transfert, tout en évitant qu'une ancienne valeur soit réutilisée plus tard par erreur.

### Le bouton Retour
Pour revenir à la vue compacte, utilisez `app.requestDisplayMode({ mode: 'inline' })`.

N'utilisez pas `app.requestTeardown()`. Cette méthode détruit complètement le widget, alors qu'ici on veut simplement changer de mode d'affichage.

### Variante réellement utilisée dans ce projet
Le fichier `mcp-server\assets\tickets-list-widget.html` applique ce pattern avec deux clés séparées : `uigen_preview_id` et `uigen_preview_ts`. Le principe est le même : sauver un identifiant juste avant le fullscreen, relire cette information au démarrage du nouvel iframe, puis la supprimer immédiatement.

## Exemples
- Dans `openPreview()`, le widget sauvegarde l'identifiant du ticket avant `requestDisplayMode({ mode: 'fullscreen' })`.
- Au démarrage du widget, `loadPreviewState()` lit `localStorage`, vérifie l'âge de la donnée, puis `await openPreview(pendingPreviewId)` pour restaurer l'écran attendu.
- Le bouton **Retour** du mode preview appelle `requestDisplayMode({ mode: 'inline' })` pour revenir au board sans détruire le composant.

## Implémentation réelle dans `tickets-list-widget.html`

### Helpers `localStorage` exacts
Le projet n'utilise pas un exemple générique : il stocke deux clés scalaires avec une fenêtre de validité de 10 secondes.

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

### État réellement suivi par le widget
Le fullscreen n'est pas géré par une variable isolée, mais par un sous-ensemble de l'état global :

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

`previewTicketId`, `previewHtml` et `previewTitle` servent à reconstruire l'écran. `previewPollId` sert à arrêter proprement le timer au moment du retour inline.

### Restauration au démarrage du module
Le pattern de restauration est tout à la fin du fichier, après `app.connect()` et l'initialisation du thème :

```javascript
// Check if we should restore preview mode (widget re-created in fullscreen)
const pendingPreviewId = loadPreviewState();
if (pendingPreviewId) {
  clearPreviewState();
  await openPreview(pendingPreviewId);
} else {
  renderTickets();
}
```

Ce point est essentiel : le widget restauré ne tente pas de reconstruire la preview depuis un cache local riche. Il relance le flux normal `openPreview(ticketId)`.

### Flux complet de `openPreview()`
Le vrai enchaînement est : `getTicket` → état mémoire → `savePreviewState()` → `updateModelContext()` → `requestDisplayMode()` → `renderPreview()`.

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

### Nettoyage réel du bouton Retour
Le retour inline ne détruit pas le widget ; il nettoie l'état local puis demande simplement un autre mode d'affichage.

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

### Pourquoi deux clés (`uigen_preview_id` + `uigen_preview_ts`) au lieu d'un blob JSON
Le code réel montre un choix volontairement simple :
- lecture directe sans `JSON.parse()` ;
- écriture atomique facile de la date et de l'identifiant ;
- suppression explicite champ par champ ;
- robustesse meilleure dans un `try/catch` silencieux si une des clés manque ou est corrompue.

Un blob JSON aurait aussi fonctionné, mais cette version est plus tolérante pour un transfert d'état très court entre deux iframes.

### Auto-fullscreen dans `ui-preview-widget.html`
La preview libre a son propre pattern : le premier résultat d'outil passe automatiquement en fullscreen dans `showPreview()`.

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

  const label = type === 'update' ? 'Mis a jour' : 'Genere';
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
Dans ce projet :
- `requestDisplayMode({ mode: 'fullscreen' })` ou `inline` = on demande au host de changer le **mode d'affichage** du même widget logique ;
- `requestTeardown()` = on demande la fermeture/destruction du widget.

Le board tickets utilise `inline` au retour parce qu'il veut préserver le scénario utilisateur : revenir au backlog, pas fermer l'expérience entière.

