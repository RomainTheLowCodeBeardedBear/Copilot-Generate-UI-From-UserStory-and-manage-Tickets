import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const previewWidgetHtml = readFileSync(join(__dirname, '../assets/ui-preview-widget.html'), 'utf8');

const PREVIEW_URI = 'ui://uigenerator/preview.html';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'uigenerator', version: '1.0.0' });

  // Register the preview widget as a resource
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

  // Tool: generateUI - creates a new interface from scratch
  registerAppTool(
    server,
    'generateUI',
    {
      description: 'Genere une interface HTML/CSS/JS complete a partir d\'une description',
      inputSchema: {
        description: z.string().describe('Description de l\'interface generee'),
        htmlCode: z.string().describe('Code HTML/CSS/JS complet auto-contenu'),
      },
      _meta: {
        ui: { resourceUri: PREVIEW_URI },
      },
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

  // Tool: updateUI - modifies an existing interface
  registerAppTool(
    server,
    'updateUI',
    {
      description: 'Met a jour l\'interface existante avec les modifications demandees',
      inputSchema: {
        description: z.string().describe('Description des modifications apportees'),
        htmlCode: z.string().describe('Code HTML/CSS/JS complet mis a jour'),
      },
      _meta: {
        ui: { resourceUri: PREVIEW_URI },
      },
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

  return server;
}
