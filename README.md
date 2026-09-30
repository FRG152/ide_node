# IDE Node

Explorador de proyectos de escritorio: muestra la estructura de carpetas como un grafo de nodos
interactivo (React Flow) para tener una visión global del proyecto y encontrar archivos rápido.

## Comandos

```bash
npm install
npm run dev                               # desarrollo con recarga en caliente
npm run dev -- -- C:\ruta\a\mi-proyecto   # arranca abriendo esa carpeta
npm run build                             # compila a ./out
npm run typecheck
```

## Uso

| Acción | Resultado |
| --- | --- |
| Clic en carpeta | Expande/colapsa (la carpeta se queda fija bajo el cursor) |
| Clic en archivo | Vista previa de solo lectura en el panel derecho |
| `Ctrl+P` | Búsqueda difusa de archivos y carpetas; `Enter` expande la ruta y centra el nodo |
| `Ctrl+O` | Abrir carpeta |
| Nodo `+N más…` | Las carpetas muestran 100 hijos como máximo; clic para ver todos |

`node_modules`, `dist`, `build`, `.venv`… se muestran atenuadas y no entran en la búsqueda.
`.git` no se muestra. La lista está en `src/main/fileSystem.ts`.

## Arquitectura

```
src/
  shared/ipc.ts        Contrato main <-> renderer (tipos + canales IPC)
  main/                Proceso Node: acceso al disco, diálogo, shell
    index.ts           Ventana + handlers IPC
    fileSystem.ts      listDir, índice de búsqueda, vista previa
  preload/index.ts     Expone window.api (contextBridge)
  renderer/src/
    store.ts           Estado del proyecto (zustand): árbol cargado, expandidos, selección
    graph/buildGraph.ts  Árbol visible -> nodos/aristas + layout
    graph/ProjectGraph.tsx  Lienzo React Flow y movimientos de cámara
    graph/nodes.tsx    Nodos personalizados (carpeta, archivo, "+N más")
    components/        Barra superior, buscador, vista previa, barra de estado
```

Seguridad: `contextIsolation` + `sandbox`, sin `nodeIntegration`. El renderer solo maneja rutas
relativas a la raíz; el main rechaza cualquier ruta que salga del proyecto abierto.
