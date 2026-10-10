# Probar el control con las manos

El control con las manos es experimental. Está probado con una cámara simulada (fotos de manos
reales pasadas por el modelo) y con manos simuladas para los gestos, pero **no con una webcam
de verdad y una mano en movimiento**: esta guía es para hacer esa prueba y saber qué ajustar.

## 1. Preparación

1. Una webcam que no esté usando otra aplicación (Teams, Zoom, el navegador…).
2. En Windows: *Configuración → Privacidad → Cámara → Permitir que las aplicaciones de
   escritorio accedan a la cámara* tiene que estar activado.
3. Instalar y descargar el modelo:

   ```bash
   npm install
   ```

   Al terminar debe existir `src/renderer/public/models/hand_landmarker.task` (7,8 MB). Si no
   está (sin conexión durante la instalación), se descarga con `npm run models`.
4. Arrancar la app: `npm run dev`.

## 2. Encenderlo

1. Abre una carpeta de proyecto.
2. Pulsa **✋** en la barra superior (queda resaltado en naranja).
3. Abajo a la izquierda aparece lo que ve la cámara, con un texto debajo:

   | Texto | Significa |
   | --- | --- |
   | *Starting camera…* | Cargando el modelo y abriendo la cámara (unos segundos la primera vez) |
   | *Show a hand to the camera* | Todo listo; no ve ninguna mano |
   | *Pinch: click · …* | Está siguiendo una mano (el borde de la vista previa se pone lila) |
   | *Hand model missing…* | Falta el modelo: `npm run models` y volver a pulsar ✋ |
   | *Could not open the camera* | La cámara está ocupada, bloqueada por Windows o no hay ninguna |

## 3. Cómo poner la mano

- A unos 40–70 cm de la cámara, con la palma hacia ella y los dedos separados.
- El cursor (un anillo lila) sigue al **punto medio entre la yema del pulgar y la del índice**.
- La imagen se ve como un espejo: mover la mano a tu derecha mueve el cursor a la derecha.
- No hace falta llegar a los bordes de la imagen: la zona central ya cubre toda la ventana.
- Sobre la vista previa se dibuja el esqueleto de la mano detectada; si no aparece, el modelo
  no la está viendo (más luz, mano más de frente).

## 4. Lista de pruebas

Marca cada una. En la columna de la derecha, lo que tiene que pasar.

| # | Haz esto | Tiene que pasar |
| --- | --- | --- |
| 1 | Mueve la mano abierta por delante de la cámara | El anillo te sigue por toda la ventana, sin saltos ni retraso apreciable |
| 2 | Deja la mano quieta sobre un nodo | El anillo se queda quieto (no tiembla) y el nodo se marca con un borde lila |
| 3 | Sobre una carpeta, junta pulgar e índice y sepáralos | Mientras están juntos el anillo se vuelve naranja; al soltar, la carpeta se abre |
| 4 | Lo mismo sobre un archivo | Se abre en la ventana del editor |
| 5 | Pellizca sobre una zona vacía del grafo y mueve la mano sin soltar | El grafo se desplaza con la mano; al soltar se queda ahí y no se abre nada |
| 6 | Pellizca con las dos manos y sepáralas; luego júntalas | El grafo se acerca; luego se aleja |
| 7 | Pellizca sobre el botón `Graph` de la barra superior | Cambia a la vista de grafo (estilo Obsidian) |
| 8 | En la vista de grafo: pellizco sobre un nodo naranja | La carpeta se abre y sus archivos brotan de ella |
| 9 | En la vista de grafo: pellizca un nodo y muévelo | El nodo sigue a la mano y los demás se recolocan |
| 10 | Pellizca sobre `Collapse all`, `Tree`, un archivo de la lista de minimizados | Hacen lo mismo que con el ratón |
| 11 | Saca la mano de la imagen mientras arrastras | El anillo desaparece en un instante y lo que tenías cogido se suelta sin hacer clic |
| 12 | Pulsa ✋ otra vez (con el ratón) | Desaparecen el anillo y la vista previa, y se apaga la luz de la cámara |

## 5. Qué fijarse para afinarlo

Los valores están pensados sobre el papel; con una mano real lo normal es tener que retocar
alguno. Todos están al principio de `src/renderer/src/hands/gestures.ts`:

| Si notas que… | Constante | Cómo cambiarla |
| --- | --- | --- |
| El pellizco no se detecta o hay que apretar mucho | `PINCH_ON` (0.25) | Subirla (0.30–0.35) |
| Hace clic solo, sin pellizcar | `PINCH_ON` (0.25) | Bajarla (0.20) |
| Suelta el arrastre a medias | `PINCH_OFF` (0.40) | Subirla (0.50) |
| Los clics se convierten en pequeños arrastres | `DRAG_SLOP` (18 px) | Subirla (25–30) |
| El cursor tiembla con la mano quieta | `oneEuro(1, 0.006)`, primer número | Bajarlo (0.6) |
| El cursor va con retraso al mover rápido | `oneEuro(1, 0.006)`, segundo número | Subirlo (0.01–0.02) |
| Cuesta llegar a las esquinas de la ventana | `ZONE` | Acercar sus valores a 0.5 (zona más pequeña) |
| El cursor se pierde con parpadeos de la detección | `LOST_MS` (250) | Subirla (400) |

Con `npm run dev` los cambios en ese archivo se aplican al guardar (hay que volver a pulsar ✋).

## 6. Límites conocidos

- Un puño cerrado puede contar como pellizco (pulgar e índice quedan juntos).
- Con poca luz, a contraluz o con la mano de canto la detección falla o tiembla.
- Sirve para moverse y hacer clic, no para escribir: dentro del editor y de la terminal el
  pellizco hace clic, pero el texto sigue siendo cosa del teclado.
- En la consola de desarrollo aparece un aviso de *Content Security Policy* sobre
  `odml.pa.googleapis.com`: es la telemetría de MediaPipe, que la app bloquea a propósito. Ni
  el vídeo ni los puntos de la mano salen del equipo.

## 7. Probar sin cámara (desarrollo)

- **Gestos sin cámara:** con ✋ activado, la app acepta manos por el evento de ventana
  `ide:hand-frame` (`detail: { hands: [{ landmarks: [21 puntos {x, y} de 0 a 1], handedness }] }`),
  que pasan por el mismo motor de gestos que las de la cámara.
- **Modelo sin webcam:** Chromium puede usar un archivo como cámara:

  ```bash
  npm run build
  npx electron . --use-fake-device-for-media-stream --use-file-for-fake-video-capture=mano.mjpeg <carpeta>
  ```

  `mano.mjpeg` es una foto de una mano en JPEG de 640×480 (un `.mjpeg` es una serie de JPEG
  seguidos; con uno solo vale).
