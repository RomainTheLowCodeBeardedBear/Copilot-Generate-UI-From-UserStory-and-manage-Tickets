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
