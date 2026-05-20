# Comment générer, éditer et sauvegarder une interface depuis le chat Copilot

## Le problème

Ce projet permet de créer des interfaces HTML/CSS/JS complètes directement dans le chat M365 Copilot. Mais il y a **trois façons différentes** de le faire, selon le contexte. Si on ne comprend pas quel flux utiliser, on se retrouve avec le mauvais outil appelé, des widgets qui ne s'affichent pas, ou du travail perdu au moment de sauvegarder.

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
- Le code est **directement sauvegardé** sur le ticket.
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

## Le widget de preview

Quel que soit le cas d'usage, l'interface générée s'affiche dans le **panneau latéral** de M365 Copilot via le widget `ui-preview-widget.html`.

### Les boutons disponibles

| Bouton | Action |
|--------|--------|
| **Aperçu** | Affiche le rendu visuel de l'interface (vue par défaut) |
| **Code** | Affiche le code source HTML/CSS/JS avec coloration syntaxique + bouton Copier |
| **Retour** | Revient au Ticket Board (disponible quand on vient d'un ticket) |
| **Genere** | Régénère l'UI à partir de la description du ticket |

### Plein écran

Le widget peut s'ouvrir en plein écran (clic sur l'icône ↗️ du widget dans le chat). L'état est préservé grâce à un mécanisme de `localStorage` avec expiration de 10 secondes — voir le skill [widget-fullscreen-and-state.md](widget-fullscreen-and-state.md).

---

## Différences techniques entre les outils

| Outil | Sauvegarde serveur | `resourceUri` | Widget ouvert |
|-------|-------------------|---------------|---------------|
| `generateUI` | Non (données dans la réponse) | `preview.html` | Preview |
| `updateUI` | Non (données dans la réponse) | `preview.html` | Preview |
| `generateUIFromTicket` | Oui (`uiProposal` sur le ticket) | `preview.html` | Preview |
| `createTicket` avec `htmlCode` | Oui (ticket + UI) | `tickets-list.html` | Ticket Board |
| `saveUIToTicket` | Oui (`uiProposal` sur le ticket) | — | Aucun |

**Pourquoi cette distinction ?**
- `generateUI` / `updateUI` n'écrivent rien sur le serveur : le HTML est uniquement dans la réponse du tool, transmis au widget via `ontoolresult`. C'est du prototypage pur.
- `generateUIFromTicket` écrit sur le serveur (le ticket est mis à jour) ET envoie le HTML au widget.
- `createTicket` avec `htmlCode` crée le ticket et enregistre l'UI d'un coup, puis ouvre le Ticket Board (pas le preview).

---

## Comment le routage fonctionne

Le LLM choisit le bon outil grâce au champ `description_for_model` dans `appPackage/ai-plugin.json`. Ce champ contient les règles de routage en langage naturel :

- Si l'utilisateur **mentionne un ticket ou un ID** → `generateUIFromTicket` (Cas 1)
- Si l'utilisateur veut **créer un ticket puis son UI** → `createTicket` puis `generateUIFromTicket` (Cas 2)
- Si l'utilisateur demande juste **« crée une interface pour X »** sans parler de ticket → `generateUI` / `updateUI` (Cas 3)
- Si l'utilisateur dit **« sauvegarde ça dans un ticket »** → `createTicket` avec `htmlCode`

Pour plus de détails sur le routage, voir [llm-tool-routing.md](llm-tool-routing.md).

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

## Skills liés

- [llm-tool-routing.md](llm-tool-routing.md) — Comment configurer `description_for_model` pour que le LLM choisisse le bon outil
- [widget-display-and-resourceuri.md](widget-display-and-resourceuri.md) — Comment `resourceUri` contrôle quel widget s'ouvre
- [widget-realtime-updates.md](widget-realtime-updates.md) — Comment le preview se met à jour automatiquement pendant que le LLM travaille
- [widget-fullscreen-and-state.md](widget-fullscreen-and-state.md) — Comment le plein écran préserve l'état du widget
