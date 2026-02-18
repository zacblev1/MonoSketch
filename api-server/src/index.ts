import express from 'express';
import { loadKotlinBundle } from './kotlin-bridge';
import { createSession, getSession, deleteSession, listSessions } from './session-manager';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env.PORT || '3100', 10);

// Middleware to get session from route param
function withSession(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: `Session not found: ${req.params.id}` });
    return;
  }
  (req as any).diagramSession = session;
  next();
}

// ---- Session Routes ----

app.post('/sessions', (_req, res) => {
  try {
    const result = createSession();
    res.status(201).json(result);
  } catch (err: any) {
    res.status(409).json({ error: err.message });
  }
});

app.get('/sessions', (_req, res) => {
  res.json(listSessions());
});

app.get('/sessions/:id', withSession, (req, res) => {
  res.json({ id: req.params.id, status: 'active' });
});

app.delete('/sessions/:id', (req, res) => {
  if (deleteSession(req.params.id)) {
    res.json({ deleted: true });
  } else {
    res.status(404).json({ error: `Session not found: ${req.params.id}` });
  }
});

// ---- Shape Routes ----

app.post('/sessions/:id/shapes/rectangle', withSession, (req, res) => {
  try {
    const { left, top, width, height, fillStyleId, borderStyleId, isRoundedCorner } = req.body;
    const session = (req as any).diagramSession;
    const shapeId = session.addRectangle(
      left, top, width, height,
      fillStyleId || null,
      borderStyleId || null,
      isRoundedCorner || false
    );
    res.status(201).json({ shapeId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/sessions/:id/shapes/text', withSession, (req, res) => {
  try {
    const { left, top, width, height, text, horizontalAlign, verticalAlign, fillStyleId, borderStyleId } = req.body;
    const session = (req as any).diagramSession;
    const shapeId = session.addText(
      left, top, width, height, text,
      horizontalAlign || 'MIDDLE',
      verticalAlign || 'MIDDLE',
      fillStyleId || null,
      borderStyleId || null
    );
    res.status(201).json({ shapeId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/sessions/:id/shapes/line', withSession, (req, res) => {
  try {
    const {
      startX, startY, startDirection,
      endX, endY, endDirection,
      strokeStyleId, startAnchorId, endAnchorId, isRoundedCorner
    } = req.body;
    const session = (req as any).diagramSession;
    const shapeId = session.addLine(
      startX, startY, startDirection,
      endX, endY, endDirection,
      strokeStyleId || null,
      startAnchorId || null,
      endAnchorId || null,
      isRoundedCorner || false
    );
    res.status(201).json({ shapeId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/sessions/:id/shapes/group', withSession, (req, res) => {
  try {
    const { shapeIds } = req.body;
    const session = (req as any).diagramSession;
    const groupId = session.groupShapes(shapeIds);
    res.status(201).json({ groupId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/sessions/:id/shapes', withSession, (req, res) => {
  const session = (req as any).diagramSession;
  const shapes = JSON.parse(session.listShapes());
  res.json(shapes);
});

app.get('/sessions/:id/shapes/:shapeId', withSession, (req, res) => {
  try {
    const session = (req as any).diagramSession;
    const shape = JSON.parse(session.getShape(req.params.shapeId));
    res.json(shape);
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

app.put('/sessions/:id/shapes/:shapeId', withSession, (req, res) => {
  try {
    const session = (req as any).diagramSession;
    const { action, ...params } = req.body;
    switch (action) {
      case 'move':
        session.moveShape(req.params.shapeId, params.left, params.top);
        break;
      case 'resize':
        session.resizeShape(req.params.shapeId, params.width, params.height);
        break;
      case 'updateText':
        session.updateText(req.params.shapeId, params.text);
        break;
      case 'ungroup':
        session.ungroupShape(req.params.shapeId);
        break;
      default:
        res.status(400).json({ error: `Unknown action: ${action}` });
        return;
    }
    res.json({ updated: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/sessions/:id/shapes/:shapeId', withSession, (req, res) => {
  try {
    const session = (req as any).diagramSession;
    session.deleteShape(req.params.shapeId);
    res.json({ deleted: true });
  } catch (err: any) {
    res.status(404).json({ error: err.message });
  }
});

// ---- Render & Export Routes ----

app.get('/sessions/:id/render', withSession, (req, res) => {
  try {
    const session = (req as any).diagramSession;
    const { left, top, width, height } = req.query;
    const ascii = session.render(
      left ? parseInt(left as string) : -1,
      top ? parseInt(top as string) : -1,
      width ? parseInt(width as string) : -1,
      height ? parseInt(height as string) : -1
    );
    res.type('text/plain').send(ascii);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/sessions/:id/export', withSession, (req, res) => {
  try {
    const session = (req as any).diagramSession;
    const json = session.exportJson();
    res.type('application/json').send(json);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/sessions/:id/import', withSession, (req, res) => {
  try {
    const session = (req as any).diagramSession;
    session.importJson(JSON.stringify(req.body));
    res.json({ imported: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ---- Start Server ----

try {
  loadKotlinBundle();
  console.log('Kotlin/JS bundle loaded successfully');
} catch (err) {
  console.error(err);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`MonoSketch API server listening on http://localhost:${PORT}`);
});
