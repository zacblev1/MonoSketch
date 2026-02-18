# MonoSketch MCP Diagram Service — Design Document

**Date:** 2026-02-13
**Status:** Approved

## Goal

Enable Claude to programmatically create ASCII diagrams via MCP by running MonoSketch's core rendering engine as a local service.

## Architecture

Three new components, cleanly separated:

```
Claude Code (stdio)
       │
  MCP Protocol
       │
┌──────▼───────┐
│  MCP Server   │  TypeScript, @modelcontextprotocol/sdk
│  (stdio)      │  Translates MCP tools → HTTP calls
└──────┬───────┘
       │ HTTP/JSON
┌──────▼───────┐
│  API Server   │  Express + TypeScript
│  (port 3100)  │  Session management, REST endpoints
└──────┬───────┘
       │ require()
┌──────▼───────┐
│  Kotlin/JS    │  Headless build target (nodejs)
│  Bundle       │  Core shape/render engine
└──────────────┘
```

## Component 1: Headless Kotlin/JS Build

**Location:** `headless/`

New Gradle subproject that packages the core modules as a Node.js-compatible JS bundle.

**Dependencies (existing modules, unchanged):**
- `shape` — Shape definitions and ShapeManager
- `monoboard` — ASCII canvas (MonoBoard)
- `monobitmap` — Bitmap storage
- `monobitmap-manager` — Shape-to-bitmap caching (MonoBitmapManager)
- `graphicsgeo` — Point, Rect, Size, DirectedPoint
- `shape-serialization` — MonoFile JSON format
- `commons` — Utilities
- `uuid` — ID generation
- `livedata` — Observable state (used internally by ShapeManager)

**Build config:** `js(IR) { nodejs { } }` — targets Node.js instead of browser.

**Facade class** (`DiagramSession.kt`):

```kotlin
@JsExport
class DiagramSession {
    // Wraps ShapeManager + MonoBitmapManager + MonoBoard

    fun addRectangle(left: Int, top: Int, width: Int, height: Int, extraJson: String?): String
    fun addText(left: Int, top: Int, width: Int, height: Int, text: String, extraJson: String?): String
    fun addLine(startX: Int, startY: Int, startDir: String, endX: Int, endY: Int, endDir: String, extraJson: String?): String
    fun groupShapes(shapeIds: Array<String>): String
    fun ungroupShape(groupId: String)

    fun moveShape(shapeId: String, newLeft: Int, newTop: Int)
    fun resizeShape(shapeId: String, newWidth: Int, newHeight: Int)
    fun updateShapeExtra(shapeId: String, extraJson: String)
    fun updateText(shapeId: String, text: String)
    fun deleteShape(shapeId: String)

    fun listShapes(): String   // JSON array
    fun getShape(shapeId: String): String  // JSON object

    fun render(left: Int?, top: Int?, width: Int?, height: Int?): String  // ASCII output
    fun exportJson(): String   // MonoFile JSON
    fun importJson(json: String)
}
```

Uses primitive types and JSON strings to avoid `@JsExport` limitations with Kotlin sealed classes and complex types.

**Output:** `build/js/packages/MonoSketch-headless/kotlin/MonoSketch-headless.js`

## Component 2: Node.js HTTP API Server

**Location:** `api-server/`

**Tech:** Express + TypeScript

**Structure:**
```
api-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts             # Express server entry (port 3100)
│   ├── routes/
│   │   ├── sessions.ts      # Session CRUD
│   │   ├── shapes.ts        # Shape operations
│   │   └── render.ts        # Rendering & export
│   ├── session-manager.ts   # In-memory session store
│   └── kotlin-bridge.ts     # require() and type wrappers for Kotlin/JS bundle
└── test/
```

### Endpoints

**Session Management:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions` | Create new diagram session, returns `sessionId` |
| `GET` | `/sessions/:id` | Get session metadata |
| `DELETE` | `/sessions/:id` | Destroy session |
| `GET` | `/sessions` | List active sessions |

**Shape Operations:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions/:id/shapes/rectangle` | Create rectangle `{left, top, width, height, extra?}` |
| `POST` | `/sessions/:id/shapes/text` | Create text `{left, top, width, height, text, extra?}` |
| `POST` | `/sessions/:id/shapes/line` | Create line `{startPoint, endPoint, extra?}` |
| `POST` | `/sessions/:id/shapes/group` | Group shapes `{shapeIds[]}` |
| `GET` | `/sessions/:id/shapes` | List all shapes |
| `GET` | `/sessions/:id/shapes/:shapeId` | Get shape details |
| `PUT` | `/sessions/:id/shapes/:shapeId` | Update shape (move, resize, restyle) |
| `DELETE` | `/sessions/:id/shapes/:shapeId` | Remove shape |

**Rendering & Export:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/sessions/:id/render` | Render as ASCII text |
| `GET` | `/sessions/:id/render?bound=L,T,W,H` | Render bounded region |
| `POST` | `/sessions/:id/export` | Export as MonoFile JSON |
| `POST` | `/sessions/:id/import` | Import from MonoFile JSON |

### Session Management

- In-memory `Map<string, DiagramSession>`
- Max 20 concurrent sessions
- Auto-expire after 30 minutes of inactivity
- No persistence — export to save, import to restore

## Component 3: MCP Server

**Location:** `mcp-server/`

**Tech:** TypeScript, `@modelcontextprotocol/sdk`, stdio transport

**Structure:**
```
mcp-server/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts             # MCP stdio entry
│   ├── tools/
│   │   ├── diagram.ts       # create/delete/list/import/export
│   │   ├── shapes.ts        # add/move/resize/delete/style shapes
│   │   └── render.ts        # render_diagram
│   └── api-client.ts        # HTTP client for api-server
└── test/
```

### MCP Tools

**Diagram Lifecycle:**

| Tool | Description |
|------|-------------|
| `create_diagram` | Start new session, returns `sessionId` |
| `list_diagrams` | List active sessions |
| `delete_diagram` | Destroy a session |
| `import_diagram` | Load MonoFile JSON into new session |
| `export_diagram` | Export session as MonoFile JSON |

**Shape Creation:**

| Tool | Parameters | Description |
|------|-----------|-------------|
| `add_rectangle` | `sessionId, left, top, width, height, fill?, borderStyle?, cornerStyle?` | Add rectangle |
| `add_text` | `sessionId, left, top, width, height, text, alignment?` | Add text box |
| `add_line` | `sessionId, startX, startY, startDir, endX, endY, endDir, startDecor?, endDecor?` | Add line |
| `group_shapes` | `sessionId, shapeIds[]` | Group shapes |
| `ungroup_shapes` | `sessionId, groupId` | Ungroup |

**Shape Editing:**

| Tool | Parameters | Description |
|------|-----------|-------------|
| `move_shape` | `sessionId, shapeId, newLeft, newTop` | Reposition |
| `resize_shape` | `sessionId, shapeId, newWidth, newHeight` | Resize |
| `update_shape_style` | `sessionId, shapeId, fill?, border?, corners?, lineStyle?` | Restyle |
| `update_text` | `sessionId, shapeId, text` | Change text |
| `delete_shape` | `sessionId, shapeId` | Remove |
| `list_shapes` | `sessionId` | List all shapes |

**Rendering:**

| Tool | Parameters | Description |
|------|-----------|-------------|
| `render_diagram` | `sessionId, bound?` | Render to ASCII text |

### Example Workflow

```
1. create_diagram → sessionId
2. add_rectangle(sessionId, 0, 0, 30, 5)  → shapeId
3. add_text(sessionId, 1, 1, 28, 3, "My Service")
4. add_rectangle(sessionId, 0, 8, 30, 5)
5. add_text(sessionId, 1, 9, 28, 3, "Database")
6. add_line(sessionId, 15, 5, VERTICAL, 15, 8, VERTICAL, endDecor=ARROW)
7. render_diagram(sessionId) → ASCII output
```

## Configuration

**`.mcp.json`:**
```json
{
  "mcpServers": {
    "monosketch": {
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": {
        "MONOSKETCH_API_URL": "http://localhost:3100"
      }
    }
  }
}
```

**Running:**
```bash
# 1. Build headless Kotlin/JS bundle
./gradlew :headless:assemble

# 2. Start API server
cd api-server && npm start

# 3. MCP server launched by Claude via stdio (configured in .mcp.json)
```

## Error Handling

**Validation:**
- Rectangle/text minimum size: 1x1
- Line start and end must differ
- Shape IDs validated on every operation
- Group operations require shapes to share the same parent

**Rendering limits:**
- Auto-bounds with 1-char padding when no explicit bound given
- Max render area: 200x200 characters

**HTTP errors:**
- 400 — invalid parameters
- 404 — unknown session or shape ID
- 409 — conflicting operation
- 503 — Kotlin/JS bundle failed to load

**MCP errors:**
- Return `isError: true` content per MCP spec
- Unreachable API server returns actionable message

**Session limits:**
- Max 20 concurrent sessions
- Auto-expire after 30 minutes idle

## Potential Risks

1. **Browser API leakage** — Some Kotlin/JS modules may reference `window`/`document`. Need to audit during headless build and isolate or stub browser-specific code.
2. **`@JsExport` limitations** — Sealed classes, generics, and some Kotlin types don't export cleanly. The facade class works around this with primitives and JSON strings.
3. **`LiveData` in Node.js** — ShapeManager uses LiveData internally. Should work without browser event loop since we call methods synchronously, but needs testing.
