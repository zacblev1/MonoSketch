import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { apiRequest } from './api-client';

const server = new Server(
  { name: 'monosketch', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ---- Tool Definitions ----

const TOOLS = [
  {
    name: 'create_diagram',
    description: 'Create a new diagram session. Returns a sessionId to use with other tools.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'list_diagrams',
    description: 'List all active diagram sessions.',
    inputSchema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'delete_diagram',
    description: 'Delete a diagram session.',
    inputSchema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string', description: 'Session ID' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'add_rectangle',
    description: 'Add a rectangle to a diagram. Style IDs: Fill: F0(none), F1(space), F2(solid block), F3(medium), F4(light), F5(stripes). Border: S0(none), S1(light), S2(heavy), S3(double), S4(rounded).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        left: { type: 'number', description: 'Left column position' },
        top: { type: 'number', description: 'Top row position' },
        width: { type: 'number', description: 'Width in characters' },
        height: { type: 'number', description: 'Height in rows' },
        fillStyleId: { type: 'string', description: 'Fill style ID (F0-F5). Omit for no fill.' },
        borderStyleId: { type: 'string', description: 'Border style ID (S0-S4). Defaults to S1.' },
        isRoundedCorner: { type: 'boolean', description: 'Use rounded corners' },
      },
      required: ['sessionId', 'left', 'top', 'width', 'height'],
    },
  },
  {
    name: 'add_text',
    description: 'Add a text box to a diagram. Text is rendered inside an optional bordered/filled rectangle.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        left: { type: 'number' },
        top: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        text: { type: 'string', description: 'Text content' },
        horizontalAlign: { type: 'string', enum: ['LEFT', 'MIDDLE', 'RIGHT'], description: 'Horizontal alignment. Default: MIDDLE' },
        verticalAlign: { type: 'string', enum: ['TOP', 'MIDDLE', 'BOTTOM'], description: 'Vertical alignment. Default: MIDDLE' },
        fillStyleId: { type: 'string', description: 'Fill style ID (F0-F5)' },
        borderStyleId: { type: 'string', description: 'Border style ID (S0-S4)' },
      },
      required: ['sessionId', 'left', 'top', 'width', 'height', 'text'],
    },
  },
  {
    name: 'add_line',
    description: 'Add a line/connector. Direction: HORIZONTAL or VERTICAL (determines which way the line initially extends from the point).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        startX: { type: 'number' },
        startY: { type: 'number' },
        startDirection: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL'] },
        endX: { type: 'number' },
        endY: { type: 'number' },
        endDirection: { type: 'string', enum: ['HORIZONTAL', 'VERTICAL'] },
        strokeStyleId: { type: 'string', description: 'Line style (S1-S4)' },
        startAnchorId: { type: 'string', description: 'Start decoration. Omit for none.' },
        endAnchorId: { type: 'string', description: 'End decoration. Omit for none.' },
        isRoundedCorner: { type: 'boolean', description: 'Use rounded corners at bends' },
      },
      required: ['sessionId', 'startX', 'startY', 'startDirection', 'endX', 'endY', 'endDirection'],
    },
  },
  {
    name: 'move_shape',
    description: 'Move a shape to a new position.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        shapeId: { type: 'string' },
        left: { type: 'number', description: 'New left column' },
        top: { type: 'number', description: 'New top row' },
      },
      required: ['sessionId', 'shapeId', 'left', 'top'],
    },
  },
  {
    name: 'resize_shape',
    description: 'Resize a shape.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        shapeId: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['sessionId', 'shapeId', 'width', 'height'],
    },
  },
  {
    name: 'update_text',
    description: 'Update the text content of a text shape.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        shapeId: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['sessionId', 'shapeId', 'text'],
    },
  },
  {
    name: 'delete_shape',
    description: 'Delete a shape from a diagram.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        shapeId: { type: 'string' },
      },
      required: ['sessionId', 'shapeId'],
    },
  },
  {
    name: 'group_shapes',
    description: 'Group multiple shapes together. All shapes must share the same parent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        shapeIds: { type: 'array', items: { type: 'string' }, description: 'Shape IDs to group' },
      },
      required: ['sessionId', 'shapeIds'],
    },
  },
  {
    name: 'ungroup_shapes',
    description: 'Ungroup a group, moving its children back to the parent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        groupId: { type: 'string' },
      },
      required: ['sessionId', 'groupId'],
    },
  },
  {
    name: 'list_shapes',
    description: 'List all shapes in a diagram with their IDs, types, and bounds.',
    inputSchema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'render_diagram',
    description: 'Render a diagram as ASCII text. Returns the full ASCII art. Omit bounds to auto-fit.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        left: { type: 'number', description: 'Optional left bound' },
        top: { type: 'number', description: 'Optional top bound' },
        width: { type: 'number', description: 'Optional width (max 200)' },
        height: { type: 'number', description: 'Optional height (max 200)' },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'export_diagram',
    description: 'Export a diagram as MonoFile JSON for saving or sharing.',
    inputSchema: {
      type: 'object' as const,
      properties: { sessionId: { type: 'string' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'import_diagram',
    description: 'Import a MonoFile JSON into an existing session, replacing current content.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: { type: 'string' },
        monoFileJson: { type: 'object', description: 'The MonoFile JSON object' },
      },
      required: ['sessionId', 'monoFileJson'],
    },
  },
];

// ---- Tool Handlers ----

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_diagram': {
        const result = await apiRequest({ method: 'POST', path: '/sessions' });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'list_diagrams': {
        const result = await apiRequest({ method: 'GET', path: '/sessions' });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'delete_diagram': {
        const result = await apiRequest({ method: 'DELETE', path: `/sessions/${args!.sessionId}` });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'add_rectangle': {
        const { sessionId, ...body } = args!;
        const result = await apiRequest({ method: 'POST', path: `/sessions/${sessionId}/shapes/rectangle`, body });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'add_text': {
        const { sessionId, ...body } = args!;
        const result = await apiRequest({ method: 'POST', path: `/sessions/${sessionId}/shapes/text`, body });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'add_line': {
        const { sessionId, ...body } = args!;
        const result = await apiRequest({ method: 'POST', path: `/sessions/${sessionId}/shapes/line`, body });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'move_shape': {
        const { sessionId, shapeId, ...body } = args!;
        const result = await apiRequest({
          method: 'PUT',
          path: `/sessions/${sessionId}/shapes/${shapeId}`,
          body: { action: 'move', ...body },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'resize_shape': {
        const { sessionId, shapeId, ...body } = args!;
        const result = await apiRequest({
          method: 'PUT',
          path: `/sessions/${sessionId}/shapes/${shapeId}`,
          body: { action: 'resize', ...body },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'update_text': {
        const { sessionId, shapeId, ...body } = args!;
        const result = await apiRequest({
          method: 'PUT',
          path: `/sessions/${sessionId}/shapes/${shapeId}`,
          body: { action: 'updateText', ...body },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'delete_shape': {
        const result = await apiRequest({
          method: 'DELETE',
          path: `/sessions/${args!.sessionId}/shapes/${args!.shapeId}`,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'group_shapes': {
        const { sessionId, shapeIds } = args!;
        const result = await apiRequest({
          method: 'POST',
          path: `/sessions/${sessionId}/shapes/group`,
          body: { shapeIds },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'ungroup_shapes': {
        const { sessionId, groupId } = args!;
        const result = await apiRequest({
          method: 'PUT',
          path: `/sessions/${sessionId}/shapes/${groupId}`,
          body: { action: 'ungroup' },
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      case 'list_shapes': {
        const result = await apiRequest({ method: 'GET', path: `/sessions/${args!.sessionId}/shapes` });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'render_diagram': {
        const { sessionId, left, top, width, height } = args!;
        const params = new URLSearchParams();
        if (left !== undefined) params.set('left', String(left));
        if (top !== undefined) params.set('top', String(top));
        if (width !== undefined) params.set('width', String(width));
        if (height !== undefined) params.set('height', String(height));
        const query = params.toString() ? `?${params.toString()}` : '';
        const result = await apiRequest({ method: 'GET', path: `/sessions/${sessionId}/render${query}` });
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }] };
      }
      case 'export_diagram': {
        const result = await apiRequest({ method: 'POST', path: `/sessions/${args!.sessionId}/export` });
        return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
      }
      case 'import_diagram': {
        const { sessionId, monoFileJson } = args!;
        const result = await apiRequest({
          method: 'POST',
          path: `/sessions/${sessionId}/import`,
          body: monoFileJson,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (err: any) {
    return { content: [{ type: 'text', text: err.message }], isError: true };
  }
});

// ---- Start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server failed:', err);
  process.exit(1);
});
