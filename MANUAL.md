# 🦾 Capri Desktop — Manual de Usuario y Guía de Capacidades

**Capri Desktop** es una compañera de escritorio inteligente para Linux (diseñada y optimizada para **Niri Wayland** y **CachyOS/Arch**). Basada en el personaje de *Cyberpunk: Edgerunners*, Capri vive en tu escritorio como un constructo digital dinámico con animaciones en WebGL, soporte para múltiples monitores, integración con asistentes de código (**Google Antigravity** / **Claude Code**) y capacidades completas de ejecución de aplicaciones y comandos de terminal.

---

## 📑 Tabla de Contenidos

1. [Modos de Visualización y Ventana](#1-modos-de-visualización-y-ventana)
2. [Atajos de Teclado Globales (Niri Wayland)](#2-atajos-de-teclado-globales-niri-wayland)
3. [Interacción Física con el Avatar](#3-interacción-física-con-el-avatar)
4. [ChatBot Inteligente y Comandos](#4-chatbot-inteligente-y-comandos)
   - [Apertura de Aplicaciones y Juegos](#apertura-de-aplicaciones-y-juegos)
   - [Apertura de Páginas Web (en Chrome y/o Brave)](#apertura-de-páginas-web-en-chrome-yo-brave)
   - [Ejecución de Comandos en Terminal](#ejecución-de-comandos-en-terminal)
   - [Recordatorios y Temporizadores](#recordatorios-y-temporizadores)
   - [Control del Sistema](#control-del-sistema)
5. [Reconocimiento de Voz y Comandos por Micrófono](#5-reconocimiento-de-voz-y-comandos-por-micrófono)
6. [Modelos de IA (Ollama Local & Google Gemini)](#6-modelos-de-ia-ollama-local--google-gemini)
7. [Integración con IDE (Antigravity & Claude Code)](#7-integración-con-ide-antigravity--claude-code)
8. [Soporte Multi-Monitor y Niri](#8-soporte-multi-monitor-y-niri)
9. [Configuración y Personalización](#9-configuración-y-personalización)

---

## 1. Modos de Visualización y Ventana

Capri dispone de tres modos de ventana diseñados para adaptarse a tu flujo de trabajo sin bloquear tus aplicaciones de fondo:

| Modo | Dimensiones | Comportamiento | Clics en el fondo |
| :--- | :--- | :--- | :--- |
| **Modo Compacto (Widget)** | `376x556` px *(expande a `520x520` al hablar)* | Capri permanece en su esquina inferior izquierda en una caja ajustada a su silueta. Si habla o abres el chat, la caja se auto-expande suavemente y vuelve a contraerse al terminar. | **100% libre**: Fuera de la pequeña caja, todo el monitor es directamente clickeable. |
| **Modo Biochip** | `76x96` px | Capri se pliega dentro de su biochip en la esquina inferior izquierda. Ideal para máxima concentración. | **100% libre**: Ocupa un área minúscula en la esquina; un clic sobre el chip la hace volver. |
| **Modo Pantalla Completa (Overlay)** | Resolución completa del monitor | Capri deambula libremente, camina por la pantalla, se sienta sobre las ventanas que tienes abiertas y salta entre monitores. | Transparente visualmente con interactividad centrada en Capri. |

---

## 2. Atajos de Teclado Globales (Niri Wayland)

Configurados en `~/.config/niri/cfg/keybinds.kdl` y sincronizados mediante el puente HTTP local:

* <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>M</kbd> — **Reconocimiento y Comandos por Voz**: Activa el micrófono y escucha tus órdenes habladas en tiempo real.
* <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>C</kbd> — **Alternar Modo Biochip**: Pliega a Capri en su chip en la esquina o la hace salir.
* <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>V</kbd> — **Alternar Modo Ventana Compacta**: Cambia entre el widget compacto (`376x556`) y el modo pantalla completa.
* <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>T</kbd> — **Teletransporte**: Mueve a Capri instantáneamente a una nueva posición mediante un portal glitch.
* <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>P</kbd> — **Poseer Ventana**: Capri busca una ventana activa y se sienta en su marco superior.
* <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>S</kbd> — **Secuencia del Satélite**: Capri mira al cielo y activa la animación del satélite de Night City.
* <kbd>Mod</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> — **Iniciar Capri Desktop**.
* <kbd>Mod</kbd> + <kbd>Alt</kbd> + <kbd>C</kbd> — **Cerrar Capri Desktop** (`pkill`).

---

## 3. Interacción Física con el Avatar

El renderizador WebGL de Capri responde a eventos directos del puntero del ratón:

* **Clic Izquierdo en el Avatar**:
  - Consulta su estado de ánimo y pensamientos actuales.
  - Incrementa los puntos de vínculo (*bond*).
* **Clic Derecho en el Avatar**:
  - Abre el menú contextual (Bandeja / Ajustes) con opciones de animaciones, idioma, modelo de IA, sonido y comandos rápidos.
* **Arrastrar y Lanzar (Física de inercia)**:
  - Haz clic y mantén presionado sobre Capri para levantarla.
  - Si mueves el ratón rápido y la sueltas, saldrá despedida en esa dirección con efectos de glitch y gravedad, quejándose o riéndose según su estado de ánimo.
* **Acariciar la Melena (*Petting*)**:
  - Mueve el puntero suavemente de un lado a otro sobre su pelo/cabeza (sin presionar ningún botón). Capri se inclinará, ronroneará y emitirá destellos de energía.
* **Máscara Dormida (*Doze / Sleep*)**:
  - Tras un tiempo de inactividad, su cuerpo se desintegra y queda flotando su máscara cibernética. Si pasas el ratón cerca, abrirá un ojo o despertará.
* **Clic en el Biochip**:
  - En modo biochip, un simple clic en el icono de la esquina la desdobla y la materializa de inmediato.

---

## 4. ChatBot Inteligente y Comandos

Haz clic sobre Capri o abre su panel para conversar con ella. Capri puede responder en personaje y realizar acciones reales en tu sistema Linux:

### Apertura de Aplicaciones y Juegos
Capri busca automáticamente entre los accesos `.desktop` del sistema, paquetes Flatpak, juegos de Steam y comandos configurados:

* *"Abre Chrome"* o *"Abre Google Chrome"* $\rightarrow$ Lanza Google Chrome vía Flatpak.
* *"Abre Brave"* $\rightarrow$ Lanza el navegador Brave.
* *"Abre Dolphin"* o *"Abre archivos"* $\rightarrow$ Abre el explorador de archivos Dolphin.
* *"Abre la terminal"* o *"Abre Kitty"* $\rightarrow$ Lanza la terminal Kitty.
* *"Abre Balatro"*, *"Abre Brawlhalla"*, *"Abre Hollow Knight"* $\rightarrow$ Lanza el juego correspondiente en Steam.

### Apertura de Páginas Web (en Chrome y/o Brave)
Capri puede abrir sitios web reconociendo nombres populares, enlaces completos (`http(s)://`) o dominios (`.com`, `.org`, etc.), permitiéndote especificar en qué navegador abrirlos:

* *"Abre YouTube en Chrome"* $\rightarrow$ Lanza `https://www.youtube.com` directamente en Google Chrome (Flatpak).
* *"Abre GitHub en Brave"* $\rightarrow$ Lanza `https://github.com` directamente en Brave Browser.
* *"Abre https://gemini.google.com en Chrome"* $\rightarrow$ Abre la URL en Chrome.
* *"Abre x.com en Brave"* $\rightarrow$ Abre X (Twitter) en Brave.
* *"Abre Netflix"* o *"Abre Reddit"* $\rightarrow$ Lo abre en tu navegador predeterminado si no especificas uno.

### Ejecución de Comandos en Terminal
Capri puede lanzar comandos en una ventana interactiva de tu terminal **Kitty**:

* *"ejecuta en terminal: fastfetch"*
* *"corre en terminal: git status"*
* *"ejecuta btop"* o *"ejecuta htop"* (herramientas interactivas de CLI se abren automáticamente en terminal).
* *"corre en consola: ls -la"*

> **Nota:** La terminal se ejecuta manteniendo la salida visible (`exec bash`), permitiéndote ver los resultados sin que la ventana se cierre de golpe.

### Recordatorios y Temporizadores
* *"Recuérdame en 20 minutos revisar el despliegue"* $\rightarrow$ Capri programa una alarma con fecha/hora y te avisará con voz y animación.
* *"Temporizador 5 minutos"* $\rightarrow$ Activa una cuenta regresiva visible en su ticker superior.

### Control del Sistema
* *"Silencia el sonido"* / *"Quita el silencio"*
* *"Modo oscuro"* / *"Modo claro"*
* *"Apaga la PC en 30 minutos"* (aparece botón de confirmación en el panel para evitar acciones accidentales).

---

## 5. Reconocimiento de Voz y Comandos por Micrófono

Capri integra un sistema avanzado de **reconocimiento de voz** que te permite hablarle directamente desde cualquier aplicación o juego:

### ¿Cómo activar el micrófono?
1. **Botón en el Chat**: Haz clic en el botón `🎙️` situado junto a la caja de texto en su panel.
2. **Atajo Global**: Presiona <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>M</kbd> en cualquier momento (incluso con Capri en segundo plano o mientras programas).
3. **Bandeja del Sistema**: Clic derecho en el icono de la bandeja $\rightarrow$ *🎙️ Reconocimiento por voz*.

### Indicadores visuales y flujo
* Al activarse, el botón `🎙️` pulsa en neón magenta/rojo y el campo de texto muestra:  
  `🎙️ Escuchando... Di un comando`
* Capri escucha tu voz y transcribe en tiempo real.
* **Detección Automática de Silencio**: Cuando terminas de hablar (tras ~1.5 segundos de silencio), Capri detiene la grabación automáticamente, procesa tu orden y ejecuta la acción correspondiente sin que tengas que tocar el ratón.
* Si deseas cancelar o forzar el envío antes de tiempo, puedes hacer clic de nuevo sobre el botón `🎙️`.

### Arquitectura Dual Tolerante a Fallos (STT)
1. **Web Speech API**: Si el entorno cuenta con el backend de reconocimiento por streaming, Capri transcribe tus palabras al vuelo conforme las pronuncias.
2. **Grabación WAV + IA Multimodal Gemini**: Si el backend de Chromium no está disponible en Linux, el motor conmuta de forma automática e instantánea al capturador de audio de baja latencia con codificación WAV (16 kHz PCM) y transcripción mediante **Gemini Flash**.

### Ejemplos de comandos hablados
* 🗣️ *"Abre Chrome"* $\rightarrow$ Inicia Google Chrome.
* 🗣️ *"Abre YouTube en Brave"* $\rightarrow$ Abre YouTube en tu navegador Brave.
* 🗣️ *"Ejecuta fastfetch"* $\rightarrow$ Abre la terminal Kitty y muestra la información del sistema.
* 🗣️ *"Haz una captura de pantalla"* $\rightarrow$ Captura la pantalla y la guarda.
* 🗣️ *"Pon Bohemian Rhapsody en YouTube"* $\rightarrow$ Reproduce la canción en el navegador.
* 🗣️ *"Sube el volumen"* / *"Silencia"* $\rightarrow$ Ajusta el audio del sistema.
* 🗣️ *"¿Cómo configuro un servidor en Arch Linux?"* $\rightarrow$ Capri te responde conversacionalmente con IA.

---

## 6. Modelos de IA (Ollama Local & Google Gemini)

Capri cuenta con un sistema híbrido de inteligencia artificial:

1. **Ollama (100% Local y Privado)**:
   - Utiliza modelos locales como `llama3:latest`, `qwen`, `mistral`, etc.
   - Cuenta con precarga permanente (`keep_alive: -1`) para que responda instantáneamente sin tiempos de espera.
2. **Google Gemini Flash / Pro (Nube)**:
   - Respuestas de alta velocidad y razonamiento complejo.
   - Habilita la capacidad de visión: *"Mira mi pantalla"* tomará una captura y Capri analizará lo que estás programando o viendo.
3. **Selector de Proveedor**:
   - Configurable fácilmente desde el archivo `config.json` o desde el menú contextual en la bandeja del sistema.

---

## 7. Integración con IDE (Antigravity & Claude Code)

Capri actúa como una extensión viva de tu entorno de desarrollo mediante su servidor HTTP en el puerto `47823`:

* **Ticker de Trabajo en Tiempo Real**:  
  Mientras tu agente de IA programa, sobre la cabeza de Capri aparece un ticker glitchy:
  - `▸ Modificando main.js`
  - `▸ Ejecutando pruebas unitarias`
  - `▸ Pensando... (12s)`
* **Eventos de Código**:
  - Si una tarea falla, Capri reacciona sorprendida o preocupada.
  - Si la tarea termina con éxito, Capri celebra con una animación especial (`celebrate`).
* **Control Remoto vía API**:
  Puedes enviar comandos a Capri desde cualquier script de bash o hook de Git:
  ```bash
  # Plegar / desplegar
  curl -s -X POST http://127.0.0.1:47823/command -H 'Content-Type: application/json' -d '{"name":"toggle-visible"}'
  
  # Modo compacto
  curl -s -X POST http://127.0.0.1:47823/command -H 'Content-Type: application/json' -d '{"name":"toggle-compact"}'
  
  # Celebrar
  curl -s -X POST http://127.0.0.1:47823/command -H 'Content-Type: application/json' -d '{"name":"celebrate"}'
  ```

---

## 8. Soporte Multi-Monitor y Niri

* **Detección Automática**: Reconoce automáticamente las pantallas configuradas en Niri (`DP-1`, `HDMI-A-1`, etc.).
* **Traspaso de Pantalla**:
  - Si arrojas a Capri contra el borde que conecta con tu segundo monitor, saltará a través del borde y aterrizará en la otra pantalla.
  - Al cambiar el foco de monitor en Niri, Capri puede configurarse para acompañarte al monitor activo.
* **Reglas de Ventana Niri**:  
  La ventana está registrada como flotante pura sin bordes ni sombras para integrarse de forma invisible sobre el fondo de escritorio.

---

## 9. Configuración y Personalización

La configuración se almacena en `~/.config/capri-desktop/config.json` y en `config/commands.json` dentro del repositorio:

### `config/commands.json` (Comandos Rápidos Personalizados)
Puedes añadir cualquier aplicación o script que quieras que Capri reconozca:
```json
{
  "commands": {
    "brave": {
      "id": "brave",
      "label": "Abrir Brave Browser",
      "command": "brave",
      "args": []
    },
    "dolphin": {
      "id": "dolphin",
      "label": "Abrir Dolphin",
      "command": "dolphin",
      "args": []
    },
    "mi_script": {
      "id": "mi_script",
      "label": "Compilar Proyecto",
      "command": "npm",
      "args": ["run", "build"]
    }
  }
}
```

---
*Manual generado para Capri Desktop v0.5.1 en CachyOS / Niri Wayland.*

