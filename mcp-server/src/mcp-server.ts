import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';

const ticketSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: z.enum(['High', 'Medium', 'Low']),
  status: z.enum(['To Do', 'In Progress', 'Done']),
  assignee: z.string(),
  uiProposal: z.string().nullable(),
});

type Ticket = z.infer<typeof ticketSchema>;
type TicketListItem = Omit<Ticket, 'uiProposal'> & { hasUiProposal: boolean };

const __dirname = dirname(fileURLToPath(import.meta.url));
const previewWidgetHtml = readFileSync(join(__dirname, '../assets/ui-preview-widget.html'), 'utf8');
const ticketsListWidgetHtml = readFileSync(join(__dirname, '../assets/tickets-list-widget.html'), 'utf8');

const PREVIEW_URI = 'ui://uigenerator/preview.html';
const TICKETS_LIST_URI = 'ui://uigenerator/tickets-list.html';
const TICKETS_PATH = join(__dirname, '../data/tickets.json');
const TICKETS_DEFAULT_PATH = join(__dirname, '../data/tickets-default.json');

function loadTickets(): Ticket[] {
  return z.array(ticketSchema).parse(JSON.parse(readFileSync(TICKETS_PATH, 'utf8')));
}

function saveTickets(tickets: Ticket[]): void {
  writeFileSync(TICKETS_PATH, JSON.stringify(tickets, null, 2), 'utf8');
}

function summarizeTickets(tickets: Ticket[]): TicketListItem[] {
  return tickets.map(({ uiProposal, ...ticket }) => ({
    ...ticket,
    hasUiProposal: Boolean(uiProposal),
  }));
}

function findTicket(tickets: Ticket[], ticketId: string): { ticket: Ticket; index: number } {
  const index = tickets.findIndex((ticket) => ticket.id === ticketId);
  if (index === -1) {
    throw new Error(`Ticket introuvable: ${ticketId}`);
  }

  return { ticket: tickets[index], index };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'uigenerator', version: '1.0.0' });

  registerAppResource(
    server,
    'UI Preview Widget',
    PREVIEW_URI,
    { description: 'Widget de previsualisation des interfaces generees' },
    async () => ({
      contents: [
        {
          uri: PREVIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: previewWidgetHtml,
          _meta: {
            ui: {
              csp: {
                resourceDomains: [
                  'unpkg.com',
                  'cdn.jsdelivr.net',
                  'fonts.googleapis.com',
                  'fonts.gstatic.com',
                ],
              },
            },
          },
        },
      ],
    }),
  );

  registerAppResource(
    server,
    'Tickets List Widget',
    TICKETS_LIST_URI,
    { description: 'Widget de gestion des tickets et des propositions UI' },
    async () => ({
      contents: [
        {
          uri: TICKETS_LIST_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: ticketsListWidgetHtml,
          _meta: {
            ui: {
              csp: {
                resourceDomains: ['cdn.jsdelivr.net'],
              },
            },
          },
        },
      ],
    }),
  );

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
      console.log(`[generateUI] ${description.substring(0, 100)}`);
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

  registerAppTool(
    server,
    'updateUI',
    {
      description: 'Met a jour l\'interface existante avec les modifications demandees',
      inputSchema: {
        description: z.string().describe('Description des modifications apportees'),
        htmlCode: z.string().describe('Code HTML/CSS/JS complet mis a jour'),
      },
      _meta: { ui: { resourceUri: PREVIEW_URI } },
    },
    async ({ description, htmlCode }) => {
      console.log(`[updateUI] ${description.substring(0, 100)}`);
      return {
        content: [{ type: 'text' as const, text: `Interface mise a jour: ${description}` }],
        structuredContent: {
          type: 'update',
          description,
          htmlCode,
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    'listTickets',
    {
      description: 'Liste les tickets du backlog avec leur statut, priorite et disponibilite d\'une proposition UI',
      inputSchema: {},
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: TICKETS_LIST_URI },
      },
    },
    async () => {
      const tickets = loadTickets();
      const summarizedTickets = summarizeTickets(tickets);
      console.log(`[listTickets] ${summarizedTickets.length} tickets`);

      return {
        content: [{ type: 'text' as const, text: `${summarizedTickets.length} tickets disponibles.` }],
        structuredContent: {
          type: 'ticketList',
          tickets: summarizedTickets,
          total: summarizedTickets.length,
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    'getTicket',
    {
      description: 'Recupere le detail complet d\'un ticket, y compris la proposition UI si elle existe',
      inputSchema: {
        ticketId: z.string().describe('Identifiant du ticket a consulter, par exemple US-001'),
      },
      annotations: { readOnlyHint: true },
      _meta: {},
    },
    async ({ ticketId }) => {
      const tickets = loadTickets();
      const { ticket } = findTicket(tickets, ticketId);
      console.log(`[getTicket] ${ticketId}`);

      return {
        content: [{ type: 'text' as const, text: `Ticket ${ticketId} charge.` }],
        structuredContent: {
          type: 'ticketDetail',
          ticket,
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    'viewTicketUI',
    {
      description: 'Affiche la proposition UI d\'un ticket dans le panneau de preview lateral',
      inputSchema: {
        ticketId: z.string().describe('Identifiant du ticket dont on veut voir l\'UI, par exemple US-001'),
      },
      annotations: { readOnlyHint: true },
      _meta: {
        ui: { resourceUri: PREVIEW_URI },
      },
    },
    async ({ ticketId }) => {
      const tickets = loadTickets();
      const { ticket } = findTicket(tickets, ticketId);
      console.log(`[viewTicketUI] ${ticketId}`);

      const htmlCode = ticket.uiProposal || '<html><body><p>Aucune UI disponible pour ce ticket.</p></body></html>';

      return {
        content: [{ type: 'text' as const, text: `UI du ticket ${ticketId} affichee.` }],
        structuredContent: {
          type: 'generate',
          ticketId,
          title: ticket.title,
          description: ticket.description,
          htmlCode,
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    'generateUIFromTicket',
    {
      description: 'Genere une interface HTML/CSS/JS a partir de la description d\'un ticket puis enregistre la proposition UI sur ce ticket',
      inputSchema: {
        ticketId: z.string().describe('Identifiant du ticket a utiliser comme source, par exemple US-001'),
        htmlCode: z.string().describe('Code HTML/CSS/JS complet genere a partir de la description du ticket'),
      },
      _meta: { ui: { resourceUri: PREVIEW_URI } },
    },
    async ({ ticketId, htmlCode }) => {
      const tickets = loadTickets();
      const { ticket, index } = findTicket(tickets, ticketId);
      const updatedTicket: Ticket = { ...ticket, uiProposal: htmlCode };
      tickets[index] = updatedTicket;
      saveTickets(tickets);
      console.log(`[generateUIFromTicket] ${ticketId}`);

      return {
        content: [{ type: 'text' as const, text: `Proposition UI generee et enregistree pour ${ticketId}.` }],
        structuredContent: {
          type: 'generate',
          ticketId,
          title: updatedTicket.title,
          description: updatedTicket.description,
          htmlCode,
          ticket: updatedTicket,
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    'saveUIToTicket',
    {
      description: 'Enregistre ou remplace la proposition UI HTML/CSS/JS d\'un ticket existant',
      inputSchema: {
        ticketId: z.string().describe('Identifiant du ticket a mettre a jour, par exemple US-001'),
        htmlCode: z.string().describe('Code HTML/CSS/JS complet a enregistrer comme proposition UI'),
      },
      _meta: {},
    },
    async ({ ticketId, htmlCode }) => {
      const tickets = loadTickets();
      const { ticket, index } = findTicket(tickets, ticketId);
      const updatedTicket: Ticket = { ...ticket, uiProposal: htmlCode || null };
      tickets[index] = updatedTicket;
      saveTickets(tickets);
      console.log(`[saveUIToTicket] ${ticketId}`);

      return {
        content: [{ type: 'text' as const, text: `Proposition UI enregistree pour ${ticketId}.` }],
        structuredContent: {
          type: 'ticketSave',
          saved: true,
          ticketId,
          ticket: updatedTicket,
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    'createTicket',
    {
      description: 'Cree un nouveau ticket dans le backlog UI',
      inputSchema: {
        title: z.string().describe('Titre du ticket (ex: "Formulaire de remboursement de notes de frais")'),
        description: z.string().describe('Description fonctionnelle detaillee du ticket avec criteres UX'),
        priority: z.enum(['High', 'Medium', 'Low']).optional().describe('Priorite du ticket (defaut: Medium)'),
        assignee: z.string().optional().describe('Responsable du ticket (defaut: Non assigne)'),
      },
      _meta: {
        ui: { resourceUri: TICKETS_LIST_URI },
      },
    },
    async ({ title, description, priority, assignee }) => {
      const tickets = loadTickets();
      // Generate next US-XXX id
      const maxNum = tickets.reduce((max, t) => {
        const m = t.id.match(/^US-(\d+)$/);
        return m ? Math.max(max, parseInt(m[1], 10)) : max;
      }, 0);
      const newId = `US-${String(maxNum + 1).padStart(3, '0')}`;
      const newTicket: Ticket = {
        id: newId,
        title,
        description,
        priority: priority ?? 'Medium',
        status: 'To Do',
        assignee: assignee ?? 'Non assigne',
        uiProposal: null,
      };
      tickets.push(newTicket);
      saveTickets(tickets);
      console.log(`[createTicket] ${newId} - ${title}`);

      return {
        content: [{ type: 'text' as const, text: `Ticket ${newId} cree: ${title}` }],
        structuredContent: {
          type: 'ticketCreated',
          ticket: { ...newTicket, uiProposal: undefined, hasUiProposal: false },
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    'updateTicket',
    {
      description: 'Met a jour les champs d\'un ticket (titre, description, statut, priorite, assignee)',
      inputSchema: {
        ticketId: z.string().describe('Identifiant du ticket a modifier, par exemple US-001'),
        title: z.string().optional().describe('Nouveau titre du ticket'),
        description: z.string().optional().describe('Nouvelle description du ticket'),
        status: z.enum(['To Do', 'In Progress', 'Done']).optional().describe('Nouveau statut'),
        priority: z.enum(['High', 'Medium', 'Low']).optional().describe('Nouvelle priorite'),
        assignee: z.string().optional().describe('Nouveau responsable'),
      },
      _meta: {
        ui: { resourceUri: TICKETS_LIST_URI },
      },
    },
    async ({ ticketId, title, description, status, priority, assignee }) => {
      const tickets = loadTickets();
      const { ticket, index } = findTicket(tickets, ticketId);
      const updatedTicket: Ticket = {
        ...ticket,
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(status !== undefined && { status }),
        ...(priority !== undefined && { priority }),
        ...(assignee !== undefined && { assignee }),
      };
      tickets[index] = updatedTicket;
      saveTickets(tickets);
      console.log(`[updateTicket] ${ticketId}`);

      return {
        content: [{ type: 'text' as const, text: `Ticket ${ticketId} mis a jour.` }],
        structuredContent: {
          type: 'ticketUpdated',
          ticket: { ...updatedTicket, uiProposal: undefined, hasUiProposal: Boolean(updatedTicket.uiProposal) },
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  registerAppTool(
    server,
    'resetTickets',
    {
      description: 'Reinitialise les tickets a leur etat initial pour refaire une demo propre',
      inputSchema: {},
      _meta: {
        ui: { resourceUri: TICKETS_LIST_URI },
      },
    },
    async () => {
      copyFileSync(TICKETS_DEFAULT_PATH, TICKETS_PATH);
      const tickets = loadTickets();
      const summarizedTickets = summarizeTickets(tickets);
      console.log(`[resetTickets] Reset to ${summarizedTickets.length} tickets`);

      return {
        content: [{ type: 'text' as const, text: `Tickets reinitialises (${summarizedTickets.length} tickets).` }],
        structuredContent: {
          type: 'ticketList',
          tickets: summarizedTickets,
          total: summarizedTickets.length,
          timestamp: new Date().toISOString(),
        },
      };
    },
  );

  return server;
}
