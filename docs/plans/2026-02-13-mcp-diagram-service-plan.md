# MonoSketch MCP Diagram Service — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Claude to programmatically create ASCII diagrams via MCP by running MonoSketch's core rendering engine as a local Node.js service.

**Architecture:** Three new components — (1) headless Kotlin/JS Gradle subproject that builds the core shape/render modules for Node.js, (2) Express+TypeScript HTTP API server managing diagram sessions, (3) stdio MCP server translating tool calls to HTTP requests.

**Tech Stack:** Kotlin/JS 1.8.20 (IR compiler, nodejs target), Node.js, Express, TypeScript, @modelcontextprotocol/sdk

**Design doc:** `docs/plans/2026-02-13-mcp-diagram-service-design.md`

---

## Task 1: Create Headless Kotlin/JS Gradle Subproject

**Files:**
- Create: `headless/build.gradle.kts`
- Modify: `settings.gradle.kts` (add headless module)

**Step 1: Add headless module to settings.gradle.kts**

In `settings.gradle.kts`, add `"headless" to "headless"` to the `moduleMap`:

```kotlin
val moduleMap = mapOf(
    "headless" to "headless",   // <-- add this line
    "app" to "app",
    // ... rest unchanged
)
```

**Step 2: Create headless/build.gradle.kts**

```kotlin
plugins {
    kotlin("js")
    kotlin("plugin.serialization")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(projects.commons)
    implementation(projects.graphicsgeo)
    implementation(projects.livedata)
    implementation(projects.lifecycle)
    implementation(projects.monobitmap)
    implementation(projects.monobitmapManager)
    implementation(projects.monoboard)
    implementation(projects.shape)
    implementation(projects.shapeSerialization)
    implementation(projects.uuid)
    implementation(projects.buildEnvironment)

    implementation(libs.kotlinx.serialization.json)

    testImplementation(libs.kotlin.test.js)
}

val compilerType: org.jetbrains.kotlin.gradle.plugin.KotlinJsCompilerType by ext
kotlin {
    js(compilerType) {
        nodejs {}
        binaries.library()
    }
}
```

Key differences from other modules:
- `nodejs {}` instead of `browser { testTask { ... } }`
- `binaries.library()` to produce a `require()`-able module

**Step 3: Create directory structure**

```bash
mkdir -p headless/src/main/kotlin/mono/headless
mkdir -p headless/src/main/resources
mkdir -p headless/src/test/kotlin/mono/headless
```

**Step 4: Verify Gradle sync**

```bash
./gradlew :headless:dependencies
```

Expected: Resolves all dependencies without errors.

**Step 5: Commit**

```bash
git add headless/build.gradle.kts settings.gradle.kts
git commit -m "feat: add headless Kotlin/JS Gradle subproject for Node.js"
```

---

## Task 2: Add Node.js Browser API Compatibility Shim

The dependency chain `headless → shape → livedata → commons` pulls in `WindowExt.kt` which references `window.setTimeout`, `window.requestAnimationFrame`, and `navigator.platform`. These don't exist in Node.js. We need a JS shim that provides them.

**Files:**
- Create: `headless/src/main/resources/node-compat.js`
- Create: `headless/src/main/kotlin/mono/headless/NodeCompat.kt`

**Step 1: Create the JS compatibility shim**

Create `headless/src/main/resources/node-compat.js`:

```javascript
// Provide browser-like globals for Kotlin/JS modules that reference window/navigator
if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (id) => clearTimeout(id),
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (id) => clearInterval(id),
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        navigator: { platform: 'Node' }
    };
}
if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = { platform: 'Node' };
}
```

**Step 2: Create Kotlin init that loads the shim**

Create `headless/src/main/kotlin/mono/headless/NodeCompat.kt`:

```kotlin
package mono.headless

/**
 * Initialize Node.js compatibility shims for browser APIs used by
 * downstream Kotlin/JS modules (commons/WindowExt.kt, etc.).
 * Must be called before any shape/rendering operations.
 */
fun initNodeCompat() {
    js("""
        if (typeof globalThis.window === 'undefined') {
            globalThis.window = {
                setTimeout: function(fn, ms) { return setTimeout(fn, ms); },
                clearTimeout: function(id) { clearTimeout(id); },
                setInterval: function(fn, ms) { return setInterval(fn, ms); },
                clearInterval: function(id) { clearInterval(id); },
                requestAnimationFrame: function(fn) { return setTimeout(fn, 0); },
                cancelAnimationFrame: function(id) { clearTimeout(id); },
                navigator: { platform: 'Node' }
            };
        }
        if (typeof globalThis.navigator === 'undefined') {
            globalThis.navigator = { platform: 'Node' };
        }
    """)
}
```

**Step 3: Commit**

```bash
git add headless/src/
git commit -m "feat: add Node.js compatibility shim for browser APIs"
```

---

## Task 3: Implement DiagramSession Facade

The facade wraps ShapeManager + MonoBitmapManager + MonoBoard and exposes a JS-friendly API using primitives and JSON strings.

**Files:**
- Create: `headless/src/main/kotlin/mono/headless/DiagramSession.kt`

**Step 1: Write the DiagramSession class**

Create `headless/src/main/kotlin/mono/headless/DiagramSession.kt`:

```kotlin
@file:OptIn(ExperimentalJsExport::class)

package mono.headless

import mono.bitmap.manager.MonoBitmapManager
import mono.graphics.board.Highlight
import mono.graphics.board.MonoBoard
import mono.graphics.geo.DirectedPoint
import mono.graphics.geo.Point
import mono.graphics.geo.Rect
import mono.graphics.geo.Size
import mono.shape.ShapeManager
import mono.shape.command.*
import mono.shape.extra.*
import mono.shape.extra.manager.ShapeExtraManager
import mono.shape.extra.manager.predefined.PredefinedAnchorChar
import mono.shape.extra.manager.predefined.PredefinedRectangleFillStyle
import mono.shape.extra.manager.predefined.PredefinedStraightStrokeStyle
import mono.shape.extra.style.*
import mono.shape.shape.*
import mono.shape.serialization.ShapeSerializationUtil
import kotlinx.serialization.json.*

/**
 * A headless diagram session that wraps MonoSketch's core shape engine.
 * All complex types are exchanged as JSON strings to work around @JsExport limitations.
 */
@JsExport
class DiagramSession {
    private val shapeManager = ShapeManager()
    private val bitmapManager = MonoBitmapManager()
    private val board = MonoBoard()

    init {
        initNodeCompat()
    }

    // ---- Shape Creation ----

    fun addRectangle(
        left: Int,
        top: Int,
        width: Int,
        height: Int,
        fillStyleId: String? = null,
        borderStyleId: String? = null,
        isRoundedCorner: Boolean = false
    ): String {
        val rect = Rect.byLTWH(left, top, maxOf(width, 1), maxOf(height, 1))
        val shape = Rectangle(rect)

        val extra = buildRectangleExtra(fillStyleId, borderStyleId, isRoundedCorner)
        shape.setExtra(extra)

        shapeManager.execute(ShapeManagerCommands.AddShape(shape))
        return shape.id
    }

    fun addText(
        left: Int,
        top: Int,
        width: Int,
        height: Int,
        text: String,
        horizontalAlign: String = "MIDDLE",
        verticalAlign: String = "MIDDLE",
        fillStyleId: String? = null,
        borderStyleId: String? = null
    ): String {
        val rect = Rect.byLTWH(left, top, maxOf(width, 1), maxOf(height, 1))
        val shape = Text(rect)

        shapeManager.execute(ShapeManagerCommands.AddShape(shape))
        shapeManager.execute(TextCommands.ChangeText(shape, text))

        val hAlign = TextAlign.HorizontalAlign.valueOf(horizontalAlign)
        val vAlign = TextAlign.VerticalAlign.valueOf(verticalAlign)
        val rectExtra = buildRectangleExtra(fillStyleId, borderStyleId, false)
        val textExtra = TextExtra(rectExtra, TextAlign(hAlign, vAlign))
        shape.setExtra(textExtra)

        return shape.id
    }

    fun addLine(
        startX: Int,
        startY: Int,
        startDirection: String,
        endX: Int,
        endY: Int,
        endDirection: String,
        strokeStyleId: String? = null,
        startAnchorId: String? = null,
        endAnchorId: String? = null,
        isRoundedCorner: Boolean = false
    ): String {
        val startDir = DirectedPoint.Direction.valueOf(startDirection)
        val endDir = DirectedPoint.Direction.valueOf(endDirection)
        val startPoint = DirectedPoint(startDir, startX, startY)
        val endPoint = DirectedPoint(endDir, endX, endY)

        val shape = Line(startPoint, endPoint)

        val strokeStyle = strokeStyleId?.let { findStrokeStyle(it) }
            ?: PredefinedStraightStrokeStyle.PREDEFINED_STYLES[0]
        val startAnchor = startAnchorId?.let { findAnchorChar(it) }
        val endAnchor = endAnchorId?.let { findAnchorChar(it) }

        val extra = LineExtra(
            isStrokeEnabled = true,
            userSelectedStrokeStyle = strokeStyle,
            isStartAnchorEnabled = startAnchor != null,
            userSelectedStartAnchor = startAnchor
                ?: PredefinedAnchorChar.PREDEFINED_ANCHOR_CHARS[0],
            isEndAnchorEnabled = endAnchor != null,
            userSelectedEndAnchor = endAnchor
                ?: PredefinedAnchorChar.PREDEFINED_ANCHOR_CHARS[0],
            dashPattern = StraightStrokeDashPattern.SOLID,
            isRoundedCorner = isRoundedCorner
        )
        shape.setExtra(extra)

        shapeManager.execute(ShapeManagerCommands.AddShape(shape))
        return shape.id
    }

    // ---- Shape Editing ----

    fun moveShape(shapeId: String, newLeft: Int, newTop: Int) {
        val shape = shapeManager.getShape(shapeId)
            ?: error("Shape not found: $shapeId")
        val newBound = Rect.byLTWH(newLeft, newTop, shape.bound.width, shape.bound.height)
        shapeManager.execute(GeneralShapeCommands.ChangeBound(shape, newBound))
    }

    fun resizeShape(shapeId: String, newWidth: Int, newHeight: Int) {
        val shape = shapeManager.getShape(shapeId)
            ?: error("Shape not found: $shapeId")
        val newBound = Rect.byLTWH(
            shape.bound.left,
            shape.bound.top,
            maxOf(newWidth, 1),
            maxOf(newHeight, 1)
        )
        shapeManager.execute(GeneralShapeCommands.ChangeBound(shape, newBound))
    }

    fun updateText(shapeId: String, text: String) {
        val shape = shapeManager.getShape(shapeId) as? Text
            ?: error("Text shape not found: $shapeId")
        shapeManager.execute(TextCommands.ChangeText(shape, text))
    }

    fun deleteShape(shapeId: String) {
        val shape = shapeManager.getShape(shapeId)
            ?: error("Shape not found: $shapeId")
        shapeManager.execute(ShapeManagerCommands.RemoveShape(shape))
    }

    fun groupShapes(shapeIds: Array<String>): String {
        val shapes = shapeIds.map { id ->
            shapeManager.getShape(id) ?: error("Shape not found: $id")
        }
        shapeManager.execute(ShapeManagerCommands.GroupShapes(shapes))
        // The group is the new parent of these shapes
        val firstShape = shapeManager.getShape(shapeIds[0])
            ?: error("Shape lost after grouping")
        return firstShape.parentId ?: error("No parent after grouping")
    }

    fun ungroupShape(groupId: String) {
        val group = shapeManager.getShape(groupId) as? Group
            ?: error("Group not found: $groupId")
        shapeManager.execute(ShapeManagerCommands.Ungroup(group))
    }

    // ---- Query ----

    fun listShapes(): String {
        val shapes = buildJsonArray {
            collectShapes(shapeManager.root) { shape ->
                add(shapeToJson(shape))
            }
        }
        return shapes.toString()
    }

    fun getShape(shapeId: String): String {
        val shape = shapeManager.getShape(shapeId)
            ?: error("Shape not found: $shapeId")
        return shapeToJson(shape).toString()
    }

    // ---- Rendering ----

    fun render(left: Int = -1, top: Int = -1, width: Int = -1, height: Int = -1): String {
        val allShapes = mutableListOf<AbstractShape>()
        collectShapes(shapeManager.root) { allShapes.add(it) }

        if (allShapes.isEmpty()) return ""

        // Calculate auto-bounds if not specified
        val renderBound = if (left < 0 || top < 0 || width < 0 || height < 0) {
            val minLeft = allShapes.minOf { it.bound.left } - 1
            val minTop = allShapes.minOf { it.bound.top } - 1
            val maxRight = allShapes.maxOf { it.bound.right } + 1
            val maxBottom = allShapes.maxOf { it.bound.bottom } + 1
            Rect.byLTRB(minLeft, minTop, maxRight, maxBottom)
        } else {
            Rect.byLTWH(left, top, minOf(width, 200), minOf(height, 200))
        }

        board.clearAndSetWindow(renderBound)

        for (shape in allShapes) {
            val bitmap = bitmapManager.getBitmap(shape) ?: continue
            board.fill(shape.bound.position, bitmap, Highlight.NO)
        }

        return board.toStringInBound(renderBound)
    }

    // ---- Import/Export ----

    fun exportJson(): String {
        val serializableRoot = shapeManager.root.toSerializableShape(isIdIncluded = true)
            as mono.shape.serialization.SerializableGroup
        return ShapeSerializationUtil.toMonoFileJson(
            name = "Headless Diagram",
            serializableShape = serializableRoot,
            connectors = emptyList(),
            offset = Point.ZERO
        )
    }

    fun importJson(json: String) {
        val monoFile = ShapeSerializationUtil.fromMonoFileJson(json)
            ?: error("Invalid MonoFile JSON")
        val newRoot = RootGroup(monoFile.root)
        shapeManager.replaceRoot(newRoot, mono.shape.connector.ShapeConnector())
    }

    // ---- Private Helpers ----

    private fun collectShapes(group: Group, action: (AbstractShape) -> Unit) {
        for (item in group.items) {
            if (item is Group) {
                action(item)
                collectShapes(item, action)
            } else {
                action(item)
            }
        }
    }

    private fun shapeToJson(shape: AbstractShape): JsonObject = buildJsonObject {
        put("id", shape.id)
        put("type", when (shape) {
            is Rectangle -> "rectangle"
            is Text -> "text"
            is Line -> "line"
            is Group -> "group"
            else -> "unknown"
        })
        put("bound", buildJsonObject {
            put("left", shape.bound.left)
            put("top", shape.bound.top)
            put("width", shape.bound.width)
            put("height", shape.bound.height)
        })
        if (shape is Text) {
            put("text", shape.renderableText.text)
        }
    }

    private fun buildRectangleExtra(
        fillStyleId: String?,
        borderStyleId: String?,
        isRoundedCorner: Boolean
    ): RectangleExtra {
        val fillStyle = fillStyleId?.let { findFillStyle(it) }
        val borderStyle = borderStyleId?.let { findStrokeStyle(it) }

        return RectangleExtra(
            isFillEnabled = fillStyle != null,
            userSelectedFillStyle = fillStyle
                ?: PredefinedRectangleFillStyle.PREDEFINED_STYLES[0],
            isBorderEnabled = borderStyle != null || (fillStyleId == null && borderStyleId == null),
            userSelectedBorderStyle = borderStyle
                ?: PredefinedStraightStrokeStyle.PREDEFINED_STYLES[0],
            dashPattern = StraightStrokeDashPattern.SOLID,
            corner = if (isRoundedCorner) {
                RectangleBorderCornerPattern.ENABLED
            } else {
                RectangleBorderCornerPattern.DISABLED
            }
        )
    }

    private fun findFillStyle(id: String): RectangleFillStyle? =
        PredefinedRectangleFillStyle.PREDEFINED_STYLES.find { it.id == id }

    private fun findStrokeStyle(id: String): StraightStrokeStyle? =
        PredefinedStraightStrokeStyle.PREDEFINED_STYLES.find { it.id == id }

    private fun findAnchorChar(id: String): AnchorChar? =
        PredefinedAnchorChar.PREDEFINED_ANCHOR_CHARS.find { it.id == id }
}
```

**Step 2: Build to verify compilation**

```bash
./gradlew :headless:assemble
```

Expected: BUILD SUCCESSFUL. This step will likely have compilation errors that need debugging — class visibility, import paths, or API mismatches. Fix iteratively until it compiles.

**Step 3: Commit**

```bash
git add headless/src/main/kotlin/mono/headless/DiagramSession.kt
git commit -m "feat: implement DiagramSession facade for headless shape API"
```

---

## Task 4: Verify Headless Bundle in Node.js

**Files:**
- Create: `headless/test-node.js` (temporary test script)

**Step 1: Build the headless bundle**

```bash
./gradlew :headless:assemble
```

**Step 2: Find the output bundle**

```bash
ls -la headless/build/js/packages/MonoSketch-headless/kotlin/
```

The main output file should be something like `MonoSketch-headless.js`.

**Step 3: Create a quick Node.js smoke test**

Create `headless/test-node.js`:

```javascript
// Quick smoke test for the headless Kotlin/JS bundle
const lib = require('./build/js/packages/MonoSketch-headless/kotlin/MonoSketch-headless.js');

// The @JsExport class should be accessible
const DiagramSession = lib.mono.headless.DiagramSession;

const session = new DiagramSession();

// Create a rectangle
const rectId = session.addRectangle(0, 0, 20, 5);
console.log('Rectangle ID:', rectId);

// Create a text label
const textId = session.addText(1, 1, 18, 3, 'Hello World');
console.log('Text ID:', textId);

// Render
const ascii = session.render();
console.log('Rendered:');
console.log(ascii);

// List shapes
const shapes = JSON.parse(session.listShapes());
console.log('Shapes:', JSON.stringify(shapes, null, 2));

// Export
const exported = session.exportJson();
console.log('Export length:', exported.length);

console.log('\nAll smoke tests passed!');
```

**Step 4: Run the smoke test**

```bash
cd headless && node test-node.js
```

Expected: Prints shape IDs, rendered ASCII art, and "All smoke tests passed!" without errors.

If there are `window is not defined` errors, the NodeCompat shim needs debugging. If there are module resolution errors, check the package output path.

**Step 5: Clean up and commit**

```bash
rm headless/test-node.js
git add -A headless/
git commit -m "feat: verify headless Kotlin/JS bundle works in Node.js"
```

---

## Task 5: Scaffold API Server

**Files:**
- Create: `api-server/package.json`
- Create: `api-server/tsconfig.json`
- Create: `api-server/src/index.ts`
- Create: `api-server/src/kotlin-bridge.ts`
- Create: `api-server/src/session-manager.ts`

**Step 1: Create package.json**

Create `api-server/package.json`:

```json
{
  "name": "monosketch-api-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts"
  },
  "dependencies": {
    "express": "^4.21.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0"
  }
}
```

**Step 2: Create tsconfig.json**

Create `api-server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create kotlin-bridge.ts**

Create `api-server/src/kotlin-bridge.ts`:

```typescript
import path from 'path';

// Path to the headless Kotlin/JS bundle
const BUNDLE_PATH = path.resolve(
  __dirname,
  '../../headless/build/js/packages/MonoSketch-headless/kotlin/MonoSketch-headless.js'
);

let kotlinModule: any = null;

export function loadKotlinBundle(): void {
  try {
    kotlinModule = require(BUNDLE_PATH);
  } catch (err) {
    throw new Error(
      `Failed to load Kotlin/JS bundle at ${BUNDLE_PATH}. ` +
      `Run './gradlew :headless:assemble' first. Error: ${err}`
    );
  }
}

export function createDiagramSession(): any {
  if (!kotlinModule) {
    throw new Error('Kotlin bundle not loaded. Call loadKotlinBundle() first.');
  }
  const DiagramSession = kotlinModule.mono.headless.DiagramSession;
  return new DiagramSession();
}
```

**Step 4: Create session-manager.ts**

Create `api-server/src/session-manager.ts`:

```typescript
import { createDiagramSession } from './kotlin-bridge';

interface SessionEntry {
  id: string;
  session: any; // DiagramSession from Kotlin/JS
  createdAt: number;
  lastAccessedAt: number;
}

const MAX_SESSIONS = 20;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let sessions = new Map<string, SessionEntry>();
let nextId = 1;

function generateId(): string {
  return `session-${nextId++}`;
}

function cleanExpired(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (now - entry.lastAccessedAt > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}

export function createSession(): { id: string } {
  cleanExpired();
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`Maximum ${MAX_SESSIONS} concurrent sessions reached. Delete unused sessions.`);
  }
  const id = generateId();
  const session = createDiagramSession();
  sessions.set(id, {
    id,
    session,
    createdAt: Date.now(),
    lastAccessedAt: Date.now(),
  });
  return { id };
}

export function getSession(id: string): any {
  const entry = sessions.get(id);
  if (!entry) {
    return null;
  }
  entry.lastAccessedAt = Date.now();
  return entry.session;
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id);
}

export function listSessions(): Array<{ id: string; createdAt: number; lastAccessedAt: number }> {
  cleanExpired();
  return Array.from(sessions.values()).map(e => ({
    id: e.id,
    createdAt: e.createdAt,
    lastAccessedAt: e.lastAccessedAt,
  }));
}
```

**Step 5: Create index.ts entry point**

Create `api-server/src/index.ts`:

```typescript
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
```

**Step 6: Install dependencies and build**

```bash
cd api-server && npm install && npm run build
```

Expected: Compiles without TypeScript errors.

**Step 7: Test the server**

```bash
cd api-server && npm start
```

In another terminal:

```bash
# Create session
curl -s -X POST http://localhost:3100/sessions | jq .

# Create rectangle
curl -s -X POST http://localhost:3100/sessions/session-1/shapes/rectangle \
  -H 'Content-Type: application/json' \
  -d '{"left":0,"top":0,"width":20,"height":5}' | jq .

# Render
curl -s http://localhost:3100/sessions/session-1/render
```

**Step 8: Commit**

```bash
git add api-server/
git commit -m "feat: add Express API server for MonoSketch headless diagram sessions"
```

---

## Task 6: Scaffold MCP Server

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/src/api-client.ts`
- Create: `mcp-server/src/index.ts`

**Step 1: Create package.json**

Create `mcp-server/package.json`:

```json
{
  "name": "monosketch-mcp-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.0"
  }
}
```

**Step 2: Create tsconfig.json**

Create `mcp-server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create api-client.ts**

Create `mcp-server/src/api-client.ts`:

```typescript
import http from 'http';

const API_URL = process.env.MONOSKETCH_API_URL || 'http://localhost:3100';

interface RequestOptions {
  method: string;
  path: string;
  body?: any;
}

export async function apiRequest(options: RequestOptions): Promise<any> {
  const url = new URL(options.path, API_URL);

  return new Promise((resolve, reject) => {
    const reqOptions: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          try {
            const err = JSON.parse(data);
            reject(new Error(err.error || `HTTP ${res.statusCode}`));
          } catch {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
          return;
        }
        // For text/plain responses (render endpoint)
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('text/plain')) {
          resolve(data);
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(
        `Cannot reach MonoSketch API at ${API_URL}. ` +
        `Start it with: cd api-server && npm start. Error: ${err.message}`
      ));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}
```

**Step 4: Create index.ts with all MCP tools**

Create `mcp-server/src/index.ts`:

```typescript
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
    description: 'Add a rectangle to a diagram. Style IDs: Fill: F0(none), F1(space), F2(solid block), F3(medium), F4(light), F5(stripes). Border: S0(none), S1(light ─│┌┐), S2(heavy ━┃┏┓), S3(double ═║╔╗), S4(rounded ─│╭╮).',
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
        isRoundedCorner: { type: 'boolean', description: 'Use rounded corners (╭╮╯╰)' },
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
    description: 'Add a line/connector. Direction: HORIZONTAL or VERTICAL (determines which way the line initially extends from the point). Anchors: A1(▶), A12(▷), A13(►), A14(▻), A2(■), A21(□), A220(◆), A221(◇), A3(○), A4(◎), A5(●), A6(├), A61(┣), A62(╠).',
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
        startAnchorId: { type: 'string', description: 'Start decoration (A1-A62). Omit for none.' },
        endAnchorId: { type: 'string', description: 'End decoration (A1-A62). Omit for none.' },
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
```

**Step 5: Install dependencies and build**

```bash
cd mcp-server && npm install && npm run build
```

Expected: Compiles without TypeScript errors.

**Step 6: Commit**

```bash
git add mcp-server/
git commit -m "feat: add MCP server with stdio transport for MonoSketch diagram tools"
```

---

## Task 7: Add MCP Configuration

**Files:**
- Create: `.mcp.json` (project-level MCP config)

**Step 1: Create .mcp.json**

Create `.mcp.json` at the project root:

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

**Step 2: Commit**

```bash
git add .mcp.json
git commit -m "feat: add .mcp.json for MonoSketch MCP server configuration"
```

---

## Task 8: End-to-End Integration Test

**Step 1: Build all components**

```bash
./gradlew :headless:assemble
cd api-server && npm install && npm run build
cd ../mcp-server && npm install && npm run build
```

**Step 2: Start the API server**

```bash
cd api-server && npm start &
```

**Step 3: Test the full flow via curl**

```bash
# Create session
SESSION_ID=$(curl -s -X POST http://localhost:3100/sessions | node -e "process.stdin.on('data',d=>process.stdout.write(JSON.parse(d).id))")
echo "Session: $SESSION_ID"

# Add rectangle box
curl -s -X POST "http://localhost:3100/sessions/$SESSION_ID/shapes/rectangle" \
  -H 'Content-Type: application/json' \
  -d '{"left":0,"top":0,"width":30,"height":5}' | node -e "process.stdin.on('data',d=>console.log('Rect:',JSON.parse(d).shapeId))"

# Add text inside rectangle
curl -s -X POST "http://localhost:3100/sessions/$SESSION_ID/shapes/text" \
  -H 'Content-Type: application/json' \
  -d '{"left":1,"top":1,"width":28,"height":3,"text":"My Service"}' | node -e "process.stdin.on('data',d=>console.log('Text:',JSON.parse(d).shapeId))"

# Add second box
curl -s -X POST "http://localhost:3100/sessions/$SESSION_ID/shapes/rectangle" \
  -H 'Content-Type: application/json' \
  -d '{"left":0,"top":8,"width":30,"height":5}' | node -e "process.stdin.on('data',d=>console.log('Rect2:',JSON.parse(d).shapeId))"

# Add text in second box
curl -s -X POST "http://localhost:3100/sessions/$SESSION_ID/shapes/text" \
  -H 'Content-Type: application/json' \
  -d '{"left":1,"top":9,"width":28,"height":3,"text":"Database"}' | node -e "process.stdin.on('data',d=>console.log('Text2:',JSON.parse(d).shapeId))"

# Add line connecting them
curl -s -X POST "http://localhost:3100/sessions/$SESSION_ID/shapes/line" \
  -H 'Content-Type: application/json' \
  -d '{"startX":15,"startY":5,"startDirection":"VERTICAL","endX":15,"endY":8,"endDirection":"VERTICAL","endAnchorId":"A1"}' | node -e "process.stdin.on('data',d=>console.log('Line:',JSON.parse(d).shapeId))"

# Render the diagram
echo "=== Rendered Diagram ==="
curl -s "http://localhost:3100/sessions/$SESSION_ID/render"
echo ""

# List shapes
echo "=== Shapes ==="
curl -s "http://localhost:3100/sessions/$SESSION_ID/shapes" | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(JSON.parse(d),null,2)))"

# Export
echo "=== Export ==="
curl -s -X POST "http://localhost:3100/sessions/$SESSION_ID/export" | node -e "process.stdin.on('data',d=>console.log('Export size:',d.length,'bytes'))"

# Cleanup
curl -s -X DELETE "http://localhost:3100/sessions/$SESSION_ID" | node -e "process.stdin.on('data',d=>console.log('Deleted:',JSON.parse(d)))"
```

Expected: Should see ASCII diagram output with two boxes connected by a line with an arrow.

**Step 4: Stop API server and commit any fixes**

```bash
kill %1  # stop background API server
git add -A
git commit -m "test: verify end-to-end integration of headless → API → MCP pipeline"
```

---

## Summary

| Task | Component | Estimated Complexity |
|------|-----------|---------------------|
| 1 | Headless Gradle subproject | Medium — new build target, dependency resolution |
| 2 | Node.js compatibility shim | Low — simple JS globals |
| 3 | DiagramSession facade | High — main Kotlin code, API surface design |
| 4 | Verify headless in Node.js | Medium — debugging bundle issues |
| 5 | API server (Express) | Medium — routes, session management, bridge |
| 6 | MCP server | Medium — tool definitions, HTTP client |
| 7 | .mcp.json config | Low — one file |
| 8 | Integration test | Medium — full pipeline verification |

**Critical path:** Tasks 1-4 must succeed before 5-8. Task 3 (DiagramSession) is the highest risk due to potential `@JsExport` issues and class visibility problems.
