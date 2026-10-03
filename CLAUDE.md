# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

IDE Node: a Claude-focused Electron desktop IDE. The project's folder structure is shown as an interactive node graph (React Flow); a code editor (Monaco) floats over the graph, and there's an integrated terminal (xterm.js + node-pty). Claude is the user's own interactive Claude Code CLI running in a terminal tab, wired to the app so it can navigate the graph and so the app can show what it's doing. UI defaults to English (Spanish available); code comments and README are in Spanish.

## Commands

```bash
npm run dev                               # electron-vite dev server + Electron with HMR
npm run dev -- -- C:\path\to\project      # start with a folder already open (args after `--` reach Electron)
npm run build                             # bundles to ./out (~1 min: Monaco's TypeScript worker is ~13 MB)
npm run typecheck                         # tsc for both projects: tsconfig.node.json (main/preload/shared) and tsconfig.web.json (renderer)
```

There is no linter and no test suite in the repo. Changes have been verified end to end by driving the built app over the Chrome DevTools Protocol:

```bash
npm run build
npx electron . --remote-debugging-port=9333 --user-data-dir=<temp dir> <project folder>
# then connect to http://127.0.0.1:9333/json/list and use Runtime.evaluate / Input.* / Page.captureScreenshot
```

Use a separate `--user-data-dir`: a running `npm run dev` instance shares the default profile (localStorage, GPU cache). `npm run dev` (http://localhost origin) and the built app (file:// origin) have separate localStorage. Claude states can be tested without spending tokens by POSTing hook payloads to the app's `/hook` endpoint (URL and token are in `<userData>/claude-code/<pid>/mcp.json`). In a folder Claude Code hasn't seen, its trust prompt defaults to "No, exit".

## Architecture

### Processes and the IPC contract

- `src/shared/ipc.ts` is the single contract: the `IdeApi` interface (exposed as `window.api`), the `IPC` channel-name table, and every type crossing processes. Adding an IPC call means touching `shared/ipc.ts` (type + channel), `preload/index.ts`, and a handler in `main/index.ts`.
- **Paths:** the renderer only ever uses paths relative to the project root, with `/`, and the root is `""`. Only the main process knows the absolute root (`projectRoot` in `main/index.ts`); `resolveInside` in `main/fileSystem.ts` rejects anything outside it.
- The window runs with `contextIsolation` + `sandbox` (the preload may only import from `electron`) and `backgroundThrottling: false` (otherwise Chromium pauses `requestAnimationFrame` when the window is occluded and graph camera animations freeze).

### Main process (`src/main`)

- `fileSystem.ts`: listing, search index, read/write. `HIDDEN_DIRS` (never shown) and `HEAVY_DIRS` (node_modules, dist… shown dimmed, not indexed, not watched) live here.
- `watcher.ts`: recursive `fs.watch`, batched. `rename` events → the renderer relists parent folders; `change` events → open documents without local edits are reloaded.
- `terminals.ts`: node-pty sessions. Its prebuilt N-API binary works in Electron without rebuilding. On Windows the interactive shell is PowerShell only if its execution policy allows scripts (otherwise `npm.ps1` fails), else `cmd.exe`; package scripts run via `cmd /d /s /c`. Killing uses `taskkill /T /F` on the tree; don't also call `pty.kill()` after a successful taskkill (it spawns a helper that crashes with "AttachConsole failed"). Child env strips Electron/electron-vite variables and the `NODE_ENV=development` that Vite injects in dev.
- `claudeCode.ts`: launches the interactive `claude` in a pty (`terminalCreate({ claude: true })`) with `--mcp-config`, `--allowedTools mcp__ide_node`, `--append-system-prompt-file` and `--settings`, all pointing to files written at startup in `<userData>/claude-code/<pid>/` (one folder per app instance, removed synchronously on quit; folders of dead pids are cleaned at startup). The settings add **command hooks** (`node hook.js`, needs Node on PATH) for UserPromptSubmit/PreToolUse/PostToolUse/Notification/Stop. They POST the hook JSON to the app; `translateHook` turns it into `ClaudeEvent`s (working/idle/attention/tool/usage). Usage (model, context, tokens) is read from the session's `transcript_path` JSONL on Stop; plan limits are not available this way. `CLAUDE_CODE_*` session variables are stripped from every pty so the child isn't treated as a nested session.
- `ideMcp.ts`: local HTTP server (127.0.0.1, bearer token). `/hook` receives the hook payloads; `/mcp` is an MCP server (official SDK, streamable HTTP, stateless, DNS-rebinding protection) exposing `expand_folder`, `collapse_folder`, `select_node`, `open_file`, `get_view`. Calls are forwarded over the `ide:command` IPC to `renderer/src/claude/ideCommands.ts`, which drives the stores and pauses ~500 ms per step so the user can follow the navigation. **The server name must not be `ide`**: Claude Code reserves it for its VS Code/JetBrains integration and silently drops other tools from a server with that name (hence `IDE_MCP_SERVER = 'ide_node'`).
- `i18n.ts`: the main process's own strings (dialogs, menu, errors). The renderer pushes the chosen language via `setLanguage`.

### Renderer (`src/renderer/src`)

State is a set of zustand stores in `stores/`. They call each other through `useXStore.getState()` (circular imports are fine because cross-store calls only happen inside actions):

- `projectStore`: loaded tree (`entries`, `children`, `expanded`, `showAll`), `selected`, search index, package.json scripts, and `viewRequest`, the camera request queue for the graph (`fit`, `focus` with optional `ifHidden`, `keep`).
- `editorStore`: one file in the centered editor window (`active`) plus the `minimized` list (right side, in minimize order) and `dirty` flags. Monaco models are not in the store: they live in `editor/documents.ts`, and a single Monaco instance (`editor/CodeEditor.tsx`) swaps models and view state.
- `terminalStore`: terminal tabs. The xterm instances live outside React in `terminal/registry.ts`, so output keeps flowing while the panel is hidden.
- `claudeStore`: mirrors the Claude Code session in the terminal from hook events: status (`off`/`idle`/`working`/`attention`), last tool, usage/context, and the files Claude touched (highlighted in the graph). Hook events are ignored while no Claude tab is open. `terminalStore.openClaude()` (Ctrl+I, or a click on the top-left status) creates or focuses the Claude tab; in that tab Shift+Enter sends ESC+CR, which Claude Code treats as a newline.
- `zoomStore` (window zoom + per-panel font size) and `editorLayoutStore` (editor window width/maximized) persist through `lib/settings.ts`. Use `saveSetting` for anything persistent: it also calls `flushStorage`, because Chromium writes localStorage to disk with a delay and an abrupt exit loses the last change.

Graph (`graph/`):

- `buildGraph.ts` does its own O(n) tree layout during the DFS (columns by depth, leaves stacked, parents centered on their children). It is not dagre: sibling order must stay alphabetical. Folders show at most `MAX_VISIBLE_CHILDREN` children plus a "+N more" node.
- Clicking a file or folder issues a `focus` request (center it). `keep` requests are for layout shifts the user didn't click ("+N more", Claude expanding folders, file-watcher changes). In `ProjectGraph.tsx` they are applied in the nodes-sync effect: they compare the old position from React Flow's internal store with the new layout, so the anchored node stays put on screen. `fit`/`focus` compute the viewport from the **DOM-measured** container size and call `setViewport`. They don't use `fitView`/`setCenter`, because React Flow learns about panel resizes late; a ResizeObserver also re-applies the last camera move if the canvas resizes within 600 ms.

Other conventions:

- **Shortcuts:** global shortcuts (`lib/shortcuts.ts`) listen in the capture phase so they win over Monaco and xterm (Ctrl+P search, Ctrl+I Claude, Ctrl+J terminal, Ctrl+S/W, Ctrl +/-/0 window zoom). While the terminal has focus, only Ctrl+J, Ctrl+I and zoom are taken; every other key goes to Claude Code or the shell. The custom app menu in `main/index.ts` deliberately omits Electron's Ctrl+W close and zoom roles.
- **UI strings:** every user-facing string goes through `t()`/`useT()` from `i18n.ts`. `en` defines the keys; `es` is typed `Record<MessageKey, string>`, so a missing translation is a type error. Model-facing text (MCP tool descriptions, the system prompt, `ideCommands.ts` results) stays in English and is not translated.
- **Monaco** is bundled locally. Workers are imported with `?worker` through the package exports map (`monaco-editor/editor/editor.worker`, `monaco-editor/language/typescript/ts.worker`…), and the TypeScript defaults live at `monaco.typescript.*` (0.57 API). Semantic validation is off, because the worker only sees open files.
- **Theme:** the Claude Code dark palette is defined as CSS variables in `styles.css`. The same hex values are duplicated in the Monaco theme (`editor/monaco.ts`, `CLAUDE_THEME`) and the xterm theme (`terminal/registry.ts`); keep all three in sync.
