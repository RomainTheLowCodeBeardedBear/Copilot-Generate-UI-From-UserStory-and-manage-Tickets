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
