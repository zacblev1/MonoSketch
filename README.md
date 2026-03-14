# MonoSketch (Fork) — ASCII Diagrams via MCP

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)][apache2.0]
[![Kotlin](https://img.shields.io/badge/kotlin-%237F52FF.svg?style=flat&logo=kotlin&logoColor=white)][KotlinJS]

A fork of [tuanchauict/MonoSketch](https://github.com/tuanchauict/MonoSketch) that adds a headless API and MCP (Model Context Protocol) server, enabling AI assistants like Claude to programmatically create ASCII diagrams.

## What's Different in This Fork

The original MonoSketch is a client-side browser-based ASCII diagram editor. This fork extends it with a **headless diagram service** — a three-layer architecture that exposes the full MonoSketch engine as an API:

```
Claude Code  ──stdio──▶  MCP Server  ──HTTP──▶  API Server  ──▶  Kotlin/JS Bundle
                         (mcp-server)            (api-server)      (headless)
```

This means you can create diagrams like this entirely from Claude Code or any MCP-compatible client:

```
        +10-15V                0,047R
       ●─────────○───────○─░░░░░─○─○─────────○────○─────╮
    +  │         │       │       │ │         │    │     │
    ─═════─      │       │       │ │         │    │     │
    ─═════─    ──┼──     │       │╭┴╮        │    │     │
    ─═════─     ─┼─      │       ││ │ 2k2    │    │     │
    -  │      470│ +     │       ││ │        │    │     │
       │       uF│       ╰──╮    │╰┬╯       ╭┴╮   │     │
       └─────────│          │    │ │     1k │ │   │     ▽ LED
                 │         6│   7│ │8       │ │   │     ┬
              ───┴───    ╭──┴────┴─┴─╮      ╰┬╯   │     │
               ─═══─     │           │1      │  │ / BC  │
                 ─       │           ├───────○──┤/  547 │
                GND      │           │       │  │ ▶     │
                         │           │      ╭┴╮   │     │
               ╭─────────┤           │  220R│ │   ○───┤├┘  IRF9Z34
               │         │           │      │ │   │   │├─▶
               │         │  MC34063  │      ╰┬╯   │   │├─┐ BYV29       -12V6
               │         │           │       │    │      ○──┤◀─○────○───X OUT
             - │ +       │           │2      ╰────╯      │     │    │
6000 micro ────┴────     │           ├──○                C│    │   ─── 470
Farad, 40V ─ ─ ┬ ─ ─     │           │ GND               C│    │   ███  uF
Capacitor      │         │           │3                  C│    │    │\
               │         │           ├────────┤├╮        │     │   GND
               │         ╰─────┬───┬─╯          │       GND    │
               │              5│  4│            │              │
               │               │   ╰────────────○──────────────│
               │               │                               │
               ╰───────────────●─────/\/\/─────────○────░░░░░──╯
                                     2k            │         1k0
                                                  ╭┴╮
                                                  │ │5k6   3k3
                                                  │ │in Serie
                                                  ╰┬╯
                                                   │
                                                  GND
```

## MCP Diagram Service

### Quick Start

**Prerequisites:** Java 17+, Node.js

**1. Build the Kotlin/JS bundle (one-time):**
```bash
./gradlew :headless:assemble
```

**2. Install dependencies and build (one-time):**
```bash
cd api-server && npm install && npm run build
cd ../mcp-server && npm install && npm run build
```

**3. Start the API server:**
```bash
cd api-server && npm start
```

The API server runs on `http://localhost:3100`.

### Claude Code Integration

The project includes a `.mcp.json` that automatically configures the MCP server for Claude Code. With the API server running, start a Claude Code session in this directory and ask it to create diagrams.

### MCP Tools

The MCP server exposes these tools to AI assistants:

| Tool | Description |
|------|-------------|
| `create_diagram` | Create a new diagram session |
| `list_diagrams` | List active diagram sessions |
| `delete_diagram` | Delete a diagram session |
| `add_rectangle` | Add a rectangle shape |
| `add_text` | Add a text box |
| `add_line` | Add a line/connector |
| `move_shape` | Reposition a shape |
| `resize_shape` | Resize a shape |
| `update_text` | Update text content |
| `delete_shape` | Remove a shape |
| `group_shapes` | Group shapes together |
| `ungroup_shapes` | Ungroup a shape group |
| `list_shapes` | List all shapes in a diagram |
| `render_diagram` | Render diagram as ASCII text |
| `export_diagram` | Export as MonoFile JSON |
| `import_diagram` | Import MonoFile JSON |

### REST API Endpoints

The API server can also be used directly:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/sessions` | Create a new diagram session |
| GET | `/sessions` | List active sessions |
| DELETE | `/sessions/:id` | Delete a session |
| POST | `/sessions/:id/shapes/rectangle` | Add a rectangle |
| POST | `/sessions/:id/shapes/text` | Add a text box |
| POST | `/sessions/:id/shapes/line` | Add a line/connector |
| GET | `/sessions/:id/shapes` | List all shapes |
| PUT | `/sessions/:id/shapes/:shapeId` | Move, resize, update, or ungroup a shape |
| DELETE | `/sessions/:id/shapes/:shapeId` | Delete a shape |
| GET | `/sessions/:id/render` | Render diagram as ASCII text |
| POST | `/sessions/:id/export` | Export as MonoFile JSON |
| POST | `/sessions/:id/import` | Import MonoFile JSON |

## Browser Editor Features

The original MonoSketch browser editor is still fully functional:

- **Drawing tools** — Rectangles, text, and lines with various border/fill styles
- **Infinite canvas** — Unlimited scrolling in all directions
- **Autosave** — Never lose your work
- **Layer management** — Control shape stacking order
- **Dark mode**
- **Smart snapping** — Lines connect to shapes automatically
- **Export** — Copy diagrams as text (`Cmd+Shift+C` / `Ctrl+Shift+C`)

## Development

### Technology Stack
- **[Kotlin/JS][KotlinJS]** — Core application compiled to JavaScript
- **TypeScript** — API server and MCP server
- **[SASS][sass]** / **[Tailwind CSS][tailwind]** — Styling
- **Gradle** — Build system

### Running the Browser Editor

```bash
./gradlew browserDevelopmentRun --continuous -Dorg.gradle.parallel=false
```

### Prerequisites
- **Java 17+** — Required for Gradle and Kotlin compilation
- **Node.js** — Required for API/MCP servers

## Acknowledgments

This is a fork of [MonoSketch](https://github.com/tuanchauict/MonoSketch) by [@tuanchauict](https://github.com/tuanchauict). The original project provides the ASCII diagram editor and rendering engine that this fork builds upon.

## License

This project is licensed under the [Apache License 2.0][apache2.0].

[apache2.0]: https://opensource.org/licenses/Apache-2.0
[KotlinJS]: https://kotlinlang.org/docs/js-overview.html
[sass]: https://sass-lang.com/
[tailwind]: https://tailwindcss.com/
