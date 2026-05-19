# Skill : MCP App CSP - `resourceDomains`

> Court mais critique. Sans cette configuration, les ressources externes du **projet UI Generator** sont silencieusement bloquées par M365.

---

## Le problème

Les widgets MCP App s'exécutent dans une **iframe sandboxée M365**. La CSP (Content Security Policy) de M365 bloque par défaut les ressources externes : scripts CDN, feuilles de style, polices, images, modules ESM, etc.

Symptôme typique :
- le widget charge partiellement
- certaines libs semblent présentes mais ne fonctionnent pas
- les fonts ne s'appliquent pas
- le code highlighting Prism.js n'apparaît pas
- aucun message clair n'est visible côté UI

Le blocage est souvent **silencieux**.

---

## La solution : `_meta.ui.csp.resourceDomains`

Chaque widget enregistré via `registerAppResource` doit déclarer explicitement les domaines externes qu'il utilise.

```ts
registerAppResource(
  server,
  'UI Preview Widget',
  'ui://uigenerator/preview.html',
  { description: 'Widget de previsualisation UI' },
  async () => ({
    contents: [{
      uri: 'ui://uigenerator/preview.html',
      mimeType: RESOURCE_MIME_TYPE,
      text: previewWidgetHtml,
      _meta: {
        ui: {
          csp: {
            resourceDomains: [
              'unpkg.com',
              'cdn.jsdelivr.net',
              'fonts.googleapis.com',
              'fonts.gstatic.com'
            ]
          }
        }
      }
    }]
  })
);
```

---

## Domaines courants à déclarer pour ce projet

| Usage | Domaines à ajouter |
|---|---|
| Fluent UI Web Components | `unpkg.com` |
| ext-apps MCP Apps (module `App`) | `cdn.jsdelivr.net` |
| Fluent tokens / packages ESM servis par CDN | `cdn.jsdelivr.net` |
| Prism.js CSS/JS (highlight du code dans `ui-preview-widget.html`) | `cdn.jsdelivr.net` |
| Google Fonts / feuilles de style | `fonts.googleapis.com` |
| Fichiers de police Google | `fonts.gstatic.com` |

### Exemple réaliste pour `ui-preview-widget.html`

Le widget de preview utilise du code highlighting et peut charger des styles / modules depuis CDN.

```ts
_meta: {
  ui: {
    csp: {
      resourceDomains: [
        'unpkg.com',
        'cdn.jsdelivr.net',
        'fonts.googleapis.com',
        'fonts.gstatic.com'
      ]
    }
  }
}
```

### Exemple réaliste pour `tickets-list-widget.html`

Le widget backlog a une surface plus simple et peut n'avoir besoin que de `cdn.jsdelivr.net` si ses imports viennent uniquement de jsDelivr.

```ts
_meta: {
  ui: {
    csp: {
      resourceDomains: ['cdn.jsdelivr.net']
    }
  }
}
```

---

## ⚠️ Pièges importants

### 1. Le blocage est silencieux
M365 n'affiche pas toujours une erreur évidente. Les symptômes peuvent être très subtils :
- widget vide ou partiellement stylé
- composants Fluent absents
- Prism.js non chargé
- polices remplacées par une police système
- rendu visuel différent selon inline / fullscreen

### 2. La configuration CSP est **par resource**, pas globale
Chaque appel à `registerAppResource()` a sa propre liste `resourceDomains`.

Si le projet a plusieurs widgets, **chaque widget doit déclarer ses propres domaines**.

```ts
registerAppResource(server, 'Preview', PREVIEW_URI, ...);      // sa propre CSP
registerAppResource(server, 'Tickets List', TICKETS_URI, ...); // sa propre CSP
```

Ne pas supposer qu'une liste définie pour un widget s'applique automatiquement aux autres.

### 3. Un domaine peut être nécessaire pour chaque type de ressource
Un widget peut charger :
- des modules ESM
- des scripts classiques
- des fichiers CSS
- des fonts

Si une ressource pointe vers un domaine non listé, elle sera bloquée même si le reste du widget fonctionne.

### 4. Rebuild requis
La CSP est définie côté serveur dans `mcp-server.ts`.

Après modification :
1. `npm run build` dans `mcp-server`
2. redémarrer le serveur MCP
3. relancer la session si besoin

---

## Débogage

Pour identifier un domaine bloqué :

1. Ouvrir les DevTools Edge / Chrome dans M365
2. Onglet **Network** puis **Console**
3. Chercher les erreurs de type :
   - `Refused to load ... because it violates the following Content Security Policy directive`
4. Repérer le domaine exact
5. L'ajouter dans `resourceDomains`
6. rebuild puis redémarrer

---

## Exemple complet de vérification

Si `ui-preview-widget.html` utilise :
- `@modelcontextprotocol/ext-apps/+esm`
- `@fluentui/tokens/+esm`
- Prism.js CSS/JS
- éventuellement des fonts Google

alors vérifier que `resourceDomains` contient au minimum :

```ts
[
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
]
```

Si le widget tickets n'utilise que des imports jsDelivr, ne pas surcharger inutilement :

```ts
['cdn.jsdelivr.net']
```

---

## À retenir

Trois règles simples :
- le blocage CSP est souvent **silencieux**
- la config est **par widget**
- après modification, **rebuild requis**

Sur ce projet, `cdn.jsdelivr.net` est central pour MCP Apps, Fluent tokens et Prism.js, tandis que `fonts.googleapis.com` et `fonts.gstatic.com` couvrent les polices web, et `unpkg.com` reste à prévoir pour les dépendances Fluent servies via ce CDN.