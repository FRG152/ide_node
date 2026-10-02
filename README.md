# IDE Node

IDE de escritorio centrado en Claude: la estructura del proyecto se muestra como un grafo de nodos
interactivo (React Flow), con Claude integrado, editor de código (Monaco) y terminal (xterm.js +
node-pty) para trabajar y levantar el proyecto sin salir de la app. Interfaz en inglés por defecto
(español disponible en la barra de estado) y tema con la paleta de Claude Code.

## Comandos

```bash
npm install
npm run dev                               # desarrollo con recarga en caliente
npm run dev -- -- C:\ruta\a\mi-proyecto   # arranca abriendo esa carpeta
npm run build                             # compila a ./out (~1 min: el worker de TypeScript de Monaco es grande)
npm run typecheck
```

## Uso

| Acción | Resultado |
| --- | --- |
| Clic en carpeta | Expande/colapsa (la carpeta se queda fija bajo el cursor) |
| Clic en archivo | Lo abre en la ventana central del editor (su nodo queda centrado detrás) |
| `Esc` en el editor / botón `—` | Minimiza: el archivo pasa a la lista de la derecha (de arriba abajo) |
| Clic en la lista de la derecha | Vuelve a la ventana central (la que hubiera se minimiza) |
| `Ctrl+I` o clic en el estado de arriba a la izquierda | Abre (o enfoca) Claude Code en una pestaña de la terminal |
| `Shift+Enter` en la pestaña de Claude | Nueva línea en el mensaje |
| `Ctrl+P` | Búsqueda difusa; `Enter` abre el archivo y lo centra en el grafo |
| `Ctrl+S` / `Ctrl+W` | Guardar / cerrar el archivo de la ventana central |
| `Ctrl+J` | Mostrar/ocultar la terminal |
| `Ctrl +` / `Ctrl -` / `Ctrl 0` | Zoom de toda la ventana, como en VS Code (pasos de 20%) |
| `Ctrl` + rueda sobre el editor o la terminal | Tamaño de letra solo de ese panel (sobre el grafo: zoom del grafo) |
| `Ctrl+O` | Abrir carpeta |
| Botones `▶ script` | Ejecutan los scripts del `package.json` (detecta npm/pnpm/yarn/bun) |
| `■ Detener` / `↻ Reiniciar` | Matan el script y todos sus procesos hijos / lo relanzan |

- **Claude** es tu propio Claude Code (el `claude` interactivo, con tu cuenta, permisos, diffs,
  `/usage`...) corriendo en una pestaña de la terminal. La app le añade:
  - herramientas para manejar la interfaz (servidor MCP local `src/main/ideMcp.ts`,
    `mcp__ide_node__*`, con token y solo en `127.0.0.1`): si le pides abrir o enseñarte algo,
    recorre el grafo a la vista y lo abre, incluso en una línea;
  - hooks que avisan a la app de lo que hace (requieren `node` en el PATH): el grafo resalta en
    azul lo que lee y en naranja lo que edita, y arriba a la izquierda se ve si está trabajando
    (con el tiempo y la última acción), si te necesita (p. ej. un permiso) o si está listo,
    aunque la terminal esté oculta; también el modelo, el contexto en uso y los tokens.
- Con el foco en la terminal, las teclas son para Claude Code o la shell, salvo `Ctrl+J`,
  `Ctrl+I` y el zoom.
- El zoom y los tamaños de letra se recuerdan entre sesiones; si no están al 100%, aparecen en
  la barra de estado (clic para restablecer).
- Los archivos con cambios sin guardar muestran `●` en la ventana, en la lista de minimizados y en
  su nodo del grafo. Cerrar el archivo, cambiar de proyecto o cerrar la app pide confirmación.
- La app vigila el disco: los archivos creados/borrados aparecen/desaparecen del grafo, y los
  archivos abiertos sin cambios locales se recargan si otro programa los modifica.
- `node_modules`, `dist`, `build`, `.venv`… se muestran atenuadas y no entran en la búsqueda ni
  en la vigilancia. `.git` no se muestra. La lista está en `src/main/fileSystem.ts`.
- Terminal en Windows: PowerShell si su política de ejecución permite scripts; si está en
  `Restricted` (el valor por defecto) se usa `cmd.exe`, porque en PowerShell `npm` fallaría.
  Para usar PowerShell: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- El editor valida solo sintaxis en TS/JS: Monaco no ve el proyecto completo ni `node_modules`,
  así que los errores de tipos serían casi todos falsos.

## Arquitectura

```
src/
  shared/ipc.ts          Contrato main <-> renderer (tipos + canales IPC)
  main/                  Proceso Node
    index.ts             Ventana, menú, handlers IPC, confirmación de cierre
    fileSystem.ts        Listado, índice de búsqueda, lectura/escritura
    watcher.ts           fs.watch recursivo, agrupa ráfagas de eventos
    terminals.ts         Sesiones node-pty, kill del árbol de procesos
    claudeCode.ts        Lanza Claude Code en la terminal (MCP, hooks, instrucciones) y traduce sus hooks
  preload/index.ts       Expone window.api (contextBridge)
  renderer/src/
    stores/              Estado (zustand): proyecto/grafo, editor, terminales, Claude, zoom
    graph/               Árbol visible -> nodos + layout; lienzo y cámara
    editor/              Monaco (workers locales), documentos/modelos, ventana central y minimizados
    claude/              Estado de Claude (arriba a la izquierda)
    terminal/            Instancias xterm (sobreviven al ocultar el panel) y panel
    components/          Barra superior, buscador, barra de estado
    lib/shortcuts.ts     Atajos globales (en captura, por delante de Monaco/xterm)
```

Seguridad: `contextIsolation` + `sandbox`, sin `nodeIntegration`. El renderer solo maneja rutas
relativas a la raíz; el main rechaza cualquier ruta que salga del proyecto abierto. Las terminales
no heredan las variables internas de Electron/electron-vite (`ELECTRON_RENDERER_URL`, el
`NODE_ENV=development` del modo dev...).
