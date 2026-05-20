# Comment guider le LLM pour qu'il choisisse le bon outil

## Le problème
Avec 10 outils disponibles, le LLM peut facilement prendre le mauvais chemin si les règles de routage sont ambiguës. Dans ce projet, le cas classique est le suivant : l'utilisateur dit « crée une interface pour un tableau de bord » et le modèle risque de choisir `generateUIFromTicket` alors qu'aucun ticket n'existe. Le bon outil est alors `generateUI`.

## La solution
Le levier principal est `description_for_model` dans `appPackage\ai-plugin.json`. C'est le champ le plus important du projet pour le routage des outils. En pratique, le modèle lit surtout ce bloc comme une consigne continue. Il faut donc écrire **un seul paragraphe**, avec des règles explicites, sans ambiguïté.

Exemple de formulation efficace dans ce projet :

```text
TROIS CAS D'USAGE:
CAS 1 - UI depuis un ticket existant: utiliser generateUIFromTicket
CAS 2 - Créer un ticket puis son UI: d'abord createTicket, puis generateUIFromTicket
CAS 3 - UI libre SANS ticket: utiliser generateUI pour créer et updateUI pour modifier
RÈGLE: si l'utilisateur mentionne un ticket ou un ID ticket → CAS 1 ou 2
Si l'utilisateur demande juste "crée une interface pour X" sans ticket → CAS 3
```

### Autre levier : `instruction.txt`
Le fichier `appPackage\instruction.txt` joue le rôle de renfort. Il doit répéter les mêmes règles que `description_for_model`, pas les contredire. Dans ce projet, il rappelle par exemple :
- `generateUI` / `updateUI` pour les générations libres ;
- `generateUIFromTicket` pour les demandes liées à un ticket ;
- `createTicket` avec `htmlCode` pour sauvegarder une UI libre dans un ticket.

### Pièges courants
- Ne supposez pas que le LLM lira chaque description d'outil en détail : il s'appuie d'abord sur `description_for_model`.
- N'utilisez pas des formulations molles comme « peut utiliser ». Préférez `DOIT`, `TOUJOURS`, `JAMAIS`.
- Testez chaque cas séparément et vérifiez l'outil réellement choisi.
- Si le modèle se trompe encore, rendez la règle plus explicite avec des mots-clés en majuscules.

### Pattern qui marche bien
Les directives absolues fonctionnent mieux que les nuances :
- **TOUJOURS** utiliser `generateUIFromTicket` pour une UI liée à un ticket.
- **JAMAIS** utiliser `generateUIFromTicket` si l'utilisateur ne parle pas d'un ticket.
- **TOUJOURS** inclure `htmlCode` dans `createTicket` quand on sauvegarde une UI libre déjà générée.

## Exemples
- « Crée une interface pour un tableau de bord RH » → `generateUI`.
- « Ajoute un filtre et une colonne KPI à l'interface actuelle » → `updateUI`.
- « Génère l'UI du ticket US-001 » → `generateUIFromTicket`.
- « Crée un ticket pour une page profil, puis génère son UI » → `createTicket`, puis `generateUIFromTicket`.
- « Sauvegarde cette UI libre dans un ticket » → `createTicket` avec `htmlCode` contenant le dernier HTML connu.

## Artefacts réels de routage à copier

### `description_for_model` complète (`appPackage\ai-plugin.json`)
C'est le bloc le plus important du projet pour le choix d'outil. Voici la valeur exacte actuellement embarquée :

```json
"description_for_model": "Plugin de gestion de tickets UI et generation d'interfaces web. TROIS CAS D'USAGE: CAS 1 - UI depuis un ticket existant: utiliser generateUIFromTicket pour generer ou modifier l'UI d'un ticket existant. CAS 2 - Creer un ticket puis son UI: d'abord createTicket, puis generateUIFromTicket. CAS 3 - UI libre SANS ticket: quand l'utilisateur veut juste une interface sans parler de ticket, utiliser generateUI pour creer et updateUI pour modifier. L'UI s'affiche dans le panneau lateral. Quand l'utilisateur veut ensuite sauvegarder dans un ticket, appeler createTicket avec le parametre htmlCode contenant le DERNIER code HTML genere/modifie dans la conversation. REGLE: si l'utilisateur mentionne un ticket ou un ID ticket, utiliser le CAS 1 ou 2. Si l'utilisateur demande juste 'cree une interface pour X' sans mentionner de ticket, utiliser le CAS 3 (generateUI/updateUI). IMPORTANT: quand l'utilisateur demande de creer un ticket apres avoir travaille sur une UI libre, TOUJOURS inclure le htmlCode dans createTicket pour ne pas perdre le travail."
```

### `instruction.txt` répète le workflow attendu
Le fichier `appPackage\instruction.txt` ne remplace pas `description_for_model` : il la renforce. Les sections réellement lues par le modèle sont :

```text
## Fonctions disponibles

### generateUI
Genere une interface complete HTML/CSS/JS a partir d'une description en langage naturel. Le code genere s'affiche automatiquement dans le widget lateral.

### updateUI
Met a jour l'interface existante selon les modifications demandees par l'utilisateur. Garde le contexte de ce qui a ete genere precedemment et applique uniquement les changements demandes.

### generateUIFromTicket
Genere une interface HTML/CSS/JS a partir de la description d'un ticket, puis enregistre cette proposition UI sur le ticket. Le code HTML est fourni dans l'appel d'outil et la previsualisation s'affiche dans le widget lateral.

## Workflow

### Generation libre
1. Si l'utilisateur decrit une UI sans ticket, appeler `generateUI` avec une description detaillee et le code HTML complet.
2. Le widget affiche l'interface generee.
3. Decrire brievement ce qui a ete genere et les fonctionnalites incluses.

### Modifications iteratives
1. Si l'utilisateur demande un changement sur l'interface courante, appeler `updateUI` avec le code HTML complet mis a jour (pas juste le diff).
2. Le widget met a jour l'affichage.
3. Confirmer les changements effectues.

### Workflow tickets
1. Si l'utilisateur dit "show my tickets", "list tickets", "montre mes tickets" ou "liste les tickets", appeler `listTickets`.
2. Si l'utilisateur veut consulter un ticket precis, appeler `getTicket`.
3. Si l'utilisateur clique sur **Generate UI** dans le widget tickets, ou demande "generate UI for US-001" / "genere l'UI du ticket US-001", appeler `generateUIFromTicket`.
4. Si la description du ticket n'est pas deja disponible dans le contexte, appeler d'abord `getTicket`, puis generer le HTML complet et appeler `generateUIFromTicket` avec `ticketId` + `htmlCode`.
5. Si l'utilisateur clique sur **View UI**, ou veut voir une proposition existante, appeler `getTicket`.
6. Apres une iteration avec `updateUI`, si l'utilisateur dit "save to ticket", "save UI to ticket" ou "sauvegarde sur le ticket", appeler `saveUIToTicket` avec `ticketId` + le code HTML complet final.
7. Ne remplace pas `generateUI` / `updateUI` : ils restent le workflow par defaut pour les generations libres sans ticket.
```

### `functions[]` = indices secondaires de routage
Le top-level `functions[]` ajoute une couche d'indices plus fine. Voici l'extrait réel :

```json
"functions": [
  {
    "name": "generateUI",
    "description": "Genere une interface HTML/CSS/JS complete a partir d'une description libre. Pour les UIs sans ticket associe. Le resultat s'affiche dans le panneau lateral."
  },
  {
    "name": "updateUI",
    "description": "Modifie l'interface existante affichee dans le panneau lateral. Envoyer le code HTML complet mis a jour."
  },
  {
    "name": "listTickets",
    "description": "Liste les tickets du backlog UI avec statut, priorite, assignee et etat de la proposition UI."
  },
  {
    "name": "getTicket",
    "description": "Recupere le detail complet d'un ticket, y compris la proposition UI si elle existe deja."
  },
  {
    "name": "generateUIFromTicket",
    "description": "Genere ou modifie une interface HTML/CSS/JS a partir de la description d'un ticket et l'enregistre dans le ticket. Utiliser TOUJOURS ce tool pour toute creation ou modification d'UI liee a un ticket."
  },
  {
    "name": "saveUIToTicket",
    "description": "Enregistre la version finale d'une interface HTML/CSS/JS sur un ticket existant."
  },
  {
    "name": "createTicket",
    "description": "Cree un nouveau ticket. Si htmlCode est fourni, enregistre aussi la proposition UI. Utiliser quand l'utilisateur veut sauvegarder une UI libre dans un ticket."
  },
  {
    "name": "updateTicket",
    "description": "Met a jour les champs d'un ticket (titre, description, statut, priorite, assignee)."
  },
  {
    "name": "resetTickets",
    "description": "Reinitialise tous les tickets a leur etat initial pour refaire une demo propre."
  },
  {
    "name": "viewTicketUI",
    "description": "Affiche la proposition UI d'un ticket dans le panneau de preview lateral."
  }
]
```

Ces descriptions servent de **secondaire routing hints** :
- `generateUI` contient explicitement **"sans ticket associe"** ;
- `updateUI` contient **"interface existante"** ;
- `generateUIFromTicket` contient **"ticket"** + **"TOUJOURS"** ;
- `createTicket` contient **"sauvegarder une UI libre"**.

Quand `description_for_model` est ambiguë, c'est souvent ce vocabulaire court qui fait pencher le choix final.

### Les descriptions détaillées de `x-mcp_tool_description.tools[]`
Le runtime MCP redéclare aussi les outils avec leurs schémas. Exemple réel pour `generateUI` :

```json
{
  "name": "generateUI",
  "description": "Genere une interface HTML/CSS/JS complete a partir d'une description libre (sans ticket). Le resultat s'affiche dans le panneau lateral.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "description": {
        "type": "string",
        "description": "Description en langage naturel de l'interface a generer"
      },
      "htmlCode": {
        "type": "string",
        "description": "Code HTML/CSS/JS complet de l'interface generee. Document HTML valide auto-contenu."
      }
    },
    "required": ["description", "htmlCode"],
    "additionalProperties": false,
    "$schema": "http://json-schema.org/draft-07/schema#"
  },
  "execution": { "taskSupport": "forbidden" },
  "_meta": {
    "ui": { "resourceUri": "ui://uigenerator/preview.html" },
    "ui/resourceUri": "ui://uigenerator/preview.html"
  }
}
```

Ici, la phrase **"description libre (sans ticket)"** est encore un indice de routage. Les descriptions de `functions[]` et de `x-mcp_tool_description.tools[]` doivent donc raconter la même histoire.

### Conversation starters réels (`ai-plugin.json`)
Ces invites sont utiles comme jeux de tests de routage :

```json
"conversation_starters": [
  { "text": "Montre-moi les tickets UI disponibles" },
  { "text": "Genere un formulaire de contact moderne" },
  { "text": "Genere une UI pour le ticket US-001" },
  { "text": "Fais une landing page avec hero et features" }
]
```

On voit tout de suite les trois branches voulues : board tickets, UI libre, UI liée à un ticket.

## Déclaration du routage : double source à garder synchronisée

### Côté serveur (`mcp-server\src\mcp-server.ts`)
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
```

### Côté plugin (`appPackage\ai-plugin.json`)
```json
{
  "name": "generateUI",
  "_meta": {
    "ui": { "resourceUri": "ui://uigenerator/preview.html" },
    "ui/resourceUri": "ui://uigenerator/preview.html"
  }
}
```

Si ces deux couches divergent, vous obtenez un système difficile à diagnostiquer : le LLM peut choisir le bon tool, mais le mauvais widget s'ouvre ; ou inversement, le host ouvre un widget qui ne correspond plus à la narration de `description_for_model`.

## Comment déboguer un mauvais routage
1. **Commencer par `description_for_model`** : vérifier si la règle métier y est formulée en termes absolus (`TOUJOURS`, `SANS ticket`, `CAS 1/2/3`).
2. **Comparer `instruction.txt`** : il doit répéter la même règle, surtout dans `## Workflow`.
3. **Relire `functions[]`** : les mots courts comme `sans ticket associe`, `interface existante`, `ticket`, `TOUJOURS` influencent réellement la sélection.
4. **Relire `x-mcp_tool_description.tools[]`** : description, schéma et `_meta` doivent raconter la même chose que `functions[]`.
5. **Comparer au serveur** : dans `mcp-server\src\mcp-server.ts`, vérifier `registerAppTool(...)`, la `description`, l'`inputSchema` et `_meta.ui.resourceUri`.
6. **Tester avec des prompts minimaux** :
   - `Genere un formulaire de contact moderne` → doit aller vers `generateUI`
   - `Genere une UI pour le ticket US-001` → doit aller vers `generateUIFromTicket`
   - `Montre-moi les tickets UI disponibles` → doit aller vers `listTickets`
7. **En cas d'erreur persistante** : renforcer d'abord `description_for_model`, puis seulement les descriptions individuelles des tools.

