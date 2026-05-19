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
