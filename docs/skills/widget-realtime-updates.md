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
