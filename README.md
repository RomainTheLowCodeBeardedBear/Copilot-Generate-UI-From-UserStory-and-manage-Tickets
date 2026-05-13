# UI Generator Agent - M365 Copilot + MCP Server

> Agent declaratif M365 Copilot qui genere des interfaces HTML/CSS/JS a la volee. Decrivez ce que vous voulez en langage naturel, l'agent le construit en direct dans le panneau lateral. Continuez la conversation pour modifier l'interface en temps reel.

---

## Ce que fait cet agent

L'utilisateur peut, en langage naturel dans M365 Copilot :

- **Decrire une interface** (formulaire, dashboard, landing page, tableau de donnees...)
- **Voir le resultat** instantanement dans le widget lateral
- **Demander des modifications** ("change la couleur en bleu", "ajoute un bouton", "mets ca en grille"...)
- **Iterer** autant de fois que necessaire, l'interface se met a jour en temps reel

---

## Architecture technique

```
┌───────────────────────────────────────────────────────┐
│                  M365 Copilot Chat                    │
│        (Declarative Agent + MCP App widget)           │
├───────────────────────────────────────────────────────┤
│  appPackage/                                          │
│  ├─ manifest.json    (Teams app manifest v1.26)       │
│  ├─ uiGeneratorAgent.json  (Declarative agent def)   │
│  ├─ ai-plugin.json   (MCP tools: generateUI,         │
│  │                     updateUI)                      │
│  └─ instruction.txt  (System prompt)                  │
├───────────────────────────────────────────────────────┤
│  mcp-server/         (Node.js/TypeScript MCP Server)  │
│  ├─ src/index.ts     (Express + Streamable HTTP)      │
│  ├─ src/mcp-server.ts (Tools + widget registration)   │
│  └─ assets/          (HTML widget)                    │
│      └─ ui-preview-widget.html (renders generated UI) │
└───────────────────────────────────────────────────────┘
```

---

## Outils MCP disponibles

| Outil | Description |
|-------|-------------|
| `generateUI` | Genere une interface HTML/CSS/JS complete a partir d'une description en langage naturel |
| `updateUI` | Met a jour l'interface existante avec les modifications demandees |

---

## Prerequis

- Node.js 18+ / 20+ / 22+
- VS Code avec l'extension [Microsoft 365 Agents Toolkit](https://aka.ms/teams-toolkit)
- Licence Microsoft 365 Copilot

---

## Installation

```bash
git clone <URL_DU_REPO>
cd UserStoriesWithUIGenerator

# Installer les dependances du MCP Server
cd mcp-server
cp .env.sample .env
npm install
npm run build
cd ..
```

## Lancement (F5)

1. Ouvrir le projet dans VS Code
2. F5 (ou menu Run > Start Debugging)
3. Le devtunnel se cree, le MCP Server demarre, le navigateur s'ouvre sur M365 Copilot
4. Parler a l'agent : "Genere un formulaire de contact avec nom, email et message"

---

## Stack technique

- **Agent declaratif** M365 Copilot (manifest JSON + ai-plugin.json v2.4)
- **MCP Server** Node.js/TypeScript (@modelcontextprotocol/sdk, Streamable HTTP)
- **MCP Apps** (@modelcontextprotocol/ext-apps) pour le widget lateral
- **Fluent UI** Web Components pour le theme
- **M365 Agents Toolkit** pour le dev local (devtunnel, provision, F5)
