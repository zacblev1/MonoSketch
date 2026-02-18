# MonoSketch

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)][apache2.0]
[![Kotlin](https://img.shields.io/badge/kotlin-%237F52FF.svg?style=flat&logo=kotlin&logoColor=white)][KotlinJS]
[![SASS](https://img.shields.io/badge/SASS-hotpink.svg?style=flat&logo=SASS&logoColor=white)][sass]
[![GitHub release (with filter)](https://img.shields.io/github/v/release/tuanchauict/monosketch)](https://github.com/tuanchauict/MonoSketch/releases)
[![Twitter Follow](https://img.shields.io/twitter/follow/MonoSketchApp)](https://twitter.com/MonoSketchApp)

A powerful, client-side-only web-based tool for creating ASCII diagrams and text-based visualizations. Perfect for documentation, technical diagrams, and creative text art.

**Try it now at [app.monosketch.io][app]**

> **Note:** This project is being rewritten in TypeScript. Check out the [`port-to-js`](https://github.com/tuanchauict/MonoSketch/tree/port-to-js) branch or [PR #584](https://github.com/tuanchauict/MonoSketch/pull/584) for details.

## Overview

MonoSketch is a fully client-side ASCII diagram editor that runs entirely in your browser. No server-side processing, no data uploaded to the cloud - your work stays on your device. Create technical diagrams, flowcharts, circuit diagrams, and more using only ASCII characters.

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
               ─═══─     │           │1      │  │ / BC  │                    
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

## Features

### Drawing Tools
- **Rectangle** - Create bordered and filled rectangular shapes
- **Text** - Add text labels and annotations
- **Line** - Draw connecting lines with various styles

### Shape Styling
- **Fill** - Fill shapes with characters
- **Border** - Multiple border styles and characters
- **Line decorations** - Add arrows and other heads to line ends
- **Rounded corners** - Soften rectangular shapes

### Editing Capabilities
- **Infinite canvas** - Unlimited scrolling in all directions
- **Autosave** - Never lose your work
- **Multiple projects** - Organize your diagrams
- **Standard operations** - Copy, Cut, Paste, Duplicate
- **Layer management** - Move shapes and change their stacking order
- **Dark mode** - Easy on the eyes
- **Smart snapping** - Connect lines to shapes automatically

### Export Options
- Export selected shapes or entire diagrams
- Quick text copy with keyboard shortcuts:
  - macOS: `Cmd + Shift + C`
  - Windows/Linux: `Ctrl + Shift + C`

## MCP Diagram Service (Headless API)

MonoSketch can run as a headless Node.js service with an MCP (Model Context Protocol) server, allowing AI assistants like Claude to programmatically create ASCII diagrams.

### Architecture

```
Claude Code  ──stdio──▶  MCP Server  ──HTTP──▶  API Server  ──▶  Kotlin/JS Bundle
                         (mcp-server)            (api-server)      (headless)
```

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

### API Endpoints

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

## Roadmap

### Grouping
Group shapes together for easier manipulation and organization. Includes a shape tree panel for managing complex diagrams with nested structures.

### Paint Tool
Freehand drawing with custom characters, plus expanded options for fills, borders, and line decorations.

### Sharing & Collaboration
- Open files from URLs
- Share to GitHub Gist
- Import/export capabilities

## Contributing

Contributions are welcome! Whether you're fixing bugs, adding features, or improving documentation, your help is appreciated.

### Technology Stack
- **[Kotlin/JS][KotlinJS]** - The entire application is written in Kotlin, compiled to JavaScript
- **[SASS]** - CSS preprocessing
- **[Tailwind CSS][tailwind]** - Utility-first CSS framework
- **Gradle** - Build system

### Prerequisites
- **Java** - Required for Gradle and Kotlin compilation
- **Python 3.11+** (optional) - For alternative development server
- **[Pipenv]** (optional) - If using Python development server

### Development Setup

#### Option 1: Gradle (Recommended)

Run development build with hot reload:
```bash
./gradlew browserDevelopmentRun --continuous -Dorg.gradle.parallel=false
```

Run production build:
```bash
./gradlew browserProductionRun --continuous -Dorg.gradle.parallel=false
```

**Note:** The `-Dorg.gradle.parallel=false` flag is a workaround for a KotlinJS build issue with `--continuous` mode.

#### Option 2: Python Development Server

Alternative approach when Gradle hot reload is not working properly:

```bash
# Install dependencies
pipenv install

# Run development server
pipenv run dev
```

### How to Contribute

1. **Fork the repository** and create a new branch for your feature or bug fix
2. **Make your changes** following the existing code style
3. **Test your changes** thoroughly
4. **Submit a pull request** with a clear description of your changes

### Getting Help

- Open an [issue](https://github.com/tuanchauict/MonoSketch/issues) for bug reports or feature requests
- Follow [@MonoSketchApp](https://twitter.com/MonoSketchApp) on Twitter for updates

## License

This project is licensed under the [Apache License 2.0][apache2.0].

[apache2.0]: https://opensource.org/licenses/Apache-2.0

[app]: https://app.monosketch.io/

[KotlinJS]: https://kotlinlang.org/docs/js-overview.html

[Pipenv]: https://pipenv.pypa.io/en/latest/

[sass]: https://sass-lang.com/

[tailwind]: https://tailwindcss.com/
