# IDE Node

Entorno de desarrollo de escritorio centrado en un grafo: la estructura del proyecto se muestra
como nodos interactivos (React Flow), con editor de código (Monaco) y terminal integrada
(xterm.js + node-pty) para trabajar y levantar el proyecto sin salir de la app.

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
| Clic en archivo | Lo abre en el editor |
| `Ctrl+P` | Búsqueda difusa; `Enter` abre el archivo y lo centra en el grafo |
| `Ctrl+S` / `Ctrl+W` | Guardar / cerrar la pestaña activa |
| `Ctrl+Ñ` (o `` Ctrl+` ``) | Mostrar/ocultar la terminal |
| `Ctrl+O` | Abrir carpeta |
| Botones `▶ script` | Ejecutan los scripts del `package.json` (detecta npm/pnpm/yarn/bun) |
| `■ Detener` / `↻ Reiniciar` | Matan el script y todos sus procesos hijos / lo relanzan |

- Los archivos con cambios sin guardar muestran `●` en su pestaña y en su nodo del grafo.
  Cerrar la pestaña, cambiar de proyecto o cerrar la app pide confirmación.
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
  preload/index.ts       Expone window.api (contextBridge)
  renderer/src/
    stores/              Estado (zustand): proyecto/grafo, editor, terminales
    graph/               Árbol visible -> nodos + layout; lienzo y cámara
    editor/              Monaco (workers locales), documentos/modelos, pestañas
    terminal/            Instancias xterm (sobreviven al ocultar el panel) y panel
    components/          Barra superior, buscador, barra de estado
    lib/shortcuts.ts     Atajos globales (en captura, por delante de Monaco/xterm)
```

Seguridad: `contextIsolation` + `sandbox`, sin `nodeIntegration`. El renderer solo maneja rutas
relativas a la raíz; el main rechaza cualquier ruta que salga del proyecto abierto. Las terminales
no heredan las variables internas de Electron/electron-vite (`ELECTRON_RENDERER_URL`, el
`NODE_ENV=development` del modo dev...).
