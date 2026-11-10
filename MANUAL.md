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

### Apertura de Proyectos de Desarrollo en Antigravity IDE (`agy`)
Capri está sincronizada con tu directorio de desarrollo local (`/run/media/nikkurek/FILES/dev`) y con tu atajo de Wofi (<kbd>Mod</kbd>+<kbd>P</kbd>). Puedes pedirle por voz o por chat que abra cualquier proyecto directamente en **Antigravity IDE** (`agy`), o que invoque el menú interactivo de Wofi:

* *"Abre archify en agy"* o *"archify en agy"* $\rightarrow$ Abre la carpeta `/run/media/nikkurek/FILES/dev/archify` en Antigravity IDE.
* *"Abre el proyecto ciccorp-b2b"* o *"ciccorp b2b"* $\rightarrow$ Detecta el proyecto y lo lanza en Antigravity IDE.
* *"Abre ping-pong-league"* o *"ai-file-sorter en agy"* $\rightarrow$ Abre el repositorio solicitado en Antigravity.
* *"Abre capri-desktop"* $\rightarrow$ Abre el proyecto de Capri en el IDE.
* *"Ver proyectos"*, *"Selector de proyectos"* o *"Proyectos"* $\rightarrow$ Dispara inmediatamente tu script `~/.local/bin/dev-selector.sh`, desplegando el selector interactivo de **Wofi** en Niri.

> **💡 Consejo:** Capri normaliza automáticamente guiones, mayúsculas y acentos. Si pronuncias *"abre ciccorp b2b en agy"*, Capri lo asociará instantáneamente a la carpeta `ciccorp-b2b`.

### Actualización y Mantenimiento de CachyOS
Capri incluye comandos especializados para el mantenimiento de tu sistema CachyOS, ejecutándose en Kitty para que puedas ingresar tu contraseña de `sudo` y revisar los registros:

* *"Actualiza el sistema"* o *"Actualiza cachyos"* $\rightarrow$ Ejecuta el alias oficial de CachyOS: optimiza la velocidad de los servidores de réplica (`sudo cachyos-rate-mirrors`) y actualiza todos los repositorios oficiales con `sudo pacman -Syu`.
* *"Actualiza todos los paquetes"* o *"Actualizar todo"* $\rightarrow$ Actualización integral de todo el sistema: espejos más rápidos + paquetes oficiales + paquetes de AUR con `yay -Syu` + aplicaciones `flatpak update -y`.
* *"Optimiza espejos"* $\rightarrow$ Ejecuta `sudo cachyos-rate-mirrors` para conectar a los servidores más veloces.
* *"Limpia paquetes"* $\rightarrow$ Limpia dependencias huérfanas con `sudo pacman -Rns $(pacman -Qtdq)`.

### Conexiones Remotas RDP (`xfreerdp3`)
Capri se enlaza directamente con tus funciones de Fish Shell (`~/.config/fish/functions/`) para abrir sesiones remotas en ventanas independientes:

* *"Conéctame a PC2"* o *"PC2 RDP"* $\rightarrow$ Conexión remota por Tailscale a `100.79.131.120`.
* *"Conéctame a AD"* o *"Abre AD"* $\rightarrow$ Conexión al servidor Active Directory (`192.168.16.9`).
* *"Conéctame a PC"* $\rightarrow$ Conexión a tu estación local (`192.168.16.130`).
* *"Abre FS"* $\rightarrow$ Conexión al File Server (`192.168.16.10`).
* *"Abre SQL"* $\rightarrow$ Conexión al servidor de base de datos (`192.168.16.32`).
* *"Abre Profit"* $\rightarrow$ Conexión al servidor Profit (`192.168.16.2`).

### Red y VPN (Tailscale)
* *"Conecta Tailscale"* $\rightarrow$ Levanta y conecta tu red privada (`sudo tailscale up`).
* *"Desconecta Tailscale"* $\rightarrow$ Desactiva la conexión VPN (`sudo tailscale down`).
* *"Estado de Tailscale"* $\rightarrow$ Muestra los nodos activos en terminal (`tailscale status`).

### Dotfiles y Herramientas TUI de Kitty
* *"Abre mis dotfiles en agy"* $\rightarrow$ Abre tu repositorio `~/dotfiles` en Antigravity IDE.
* *"Abre lazygit"* $\rightarrow$ Abre la interfaz interactiva de Git en Kitty.
* *"LazyGit dotfiles"* (o *"lzdot"*) $\rightarrow$ Abre LazyGit directamente sobre tus dotfiles.
* *"Abre yazi"* $\rightarrow$ Lanza el explorador de consola ultra-rápido en Kitty.
* *"Abre Neovim"* (o *"nvim"*) $\rightarrow$ Abre el editor Neovim en Kitty.
* *"Abre btop"* $\rightarrow$ Monitor de recursos del sistema.
* *"Fastfetch"* $\rightarrow$ Muestra el resumen de hardware y sistema de CachyOS.
* *"Cambia el tema"* $\rightarrow$ Ejecuta tu script de cambio de tema en `~/dotfiles/scripts/theme-switch.fish`.

### Apertura de Páginas Web (en Chrome y/o Brave)
Capri puede abrir sitios web reconociendo nombres populares, enlaces completos (`http(s)://`) o dominios (`.com`, `.org`, etc.), permitiéndote especificar en qué navegador abrirlos:

* *"Abre YouTube en Chrome"* $\rightarrow$ Lanza `https://www.youtube.com` directamente en Google Chrome (Flatpak).
* *"Abre GitHub en Brave"* $\rightarrow$ Lanza `https://github.com` directamente en Brave Browser.
* *"Abre https://gemini.google.com en Chrome"* $\rightarrow$ Abre la URL en Chrome.
* *"Abre x.com en Brave"* $\rightarrow$ Abre X (Twitter) en Brave.
* *"Abre Netflix"* o *"Abre Reddit"* $\rightarrow$ Lo abre en tu navegador predeterminado si no especificas uno.

### Ejecución de Comandos en Terminal y Asistida por IA
Capri puede lanzar comandos tanto predefinidos como comandos dinámicos generados por Inteligencia Artificial en tu terminal **Kitty**:

#### 1. Comandos Asistidos por IA (`Ejecuta: <petición>`)
Cuando una orden no está en la lista de comandos fijos, puedes usar el prefijo **`Ejecuta:`** (o hablarle diciendo *"Ejecuta..."*). Capri analizará tu petición con la IA, detectará qué proyecto de desarrollo necesitas de tu carpeta `/run/media/nikkurek/FILES/dev`, compondrá el comando Bash exacto y lo ejecutará en Kitty:

* *"Ejecuta: docker compose up del proyecto ciccorp-b2b"* $\rightarrow$ La IA detecta la ruta del proyecto y ejecuta:  
  `cd "/run/media/nikkurek/FILES/dev/ciccorp-b2b" && docker compose up`
* *"Ejecuta: ver los puertos en escucha"* $\rightarrow$ Ejecuta `ss -tulpn` en Kitty.
* *"Ejecuta: cuánto espacio queda en el disco"* $\rightarrow$ Ejecuta `df -h`.
* *"Ejecuta: docker compose down del proyecto archify"* $\rightarrow$ Navega a `archify` y detiene los contenedores.
* *"Ejecuta: compila el proyecto capri-desktop"* $\rightarrow$ Ejecuta `npm run build` dentro del directorio.

#### 2. Comandos Directos y Herramientas CLI
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

## 5. Reconocimiento de Voz y Modo Manos Libres (Wake Word "Capri")

Capri integra un sistema de **escucha continua en segundo plano** tipo **Jarvis** o **Google Assistant**, permitiéndote hablarle en cualquier momento sin necesidad de hacer clic ni tocar el teclado:

### ¿Cómo funciona la palabra de activación ("Capri")?
El micrófono se mantiene **siempre abierto y atento en segundo plano**:
* **Comando directo en una sola frase:**  
  Di **"Capri"** seguido de tu orden. Capri detectará la palabra clave, despertará, abrirá su panel y ejecutará la acción de inmediato:
  - 🗣️ *"Capri, ejecuta docker ps"*
  - 🗣️ *"Capri, abre Google Chrome"*
  - 🗣️ *"Capri, actualiza cachy"*
  - 🗣️ *"Capri, abre el proyecto ciccorp b2b en agy"*
  - 🗣️ *"Oye Capri, ¿cuánta memoria RAM me queda?"*
  - 🗣️ *"Hey Capri, pon música en YouTube"*
* **Activación en dos pasos (Atención primero):**  
  Si solo dices **"Capri"** (u *"Oye Capri"*):
  - Capri emite un sonido de confirmación auditiva (`bolt`/`tick`).
  - Despierta en el escritorio y abre su panel en modo de escucha activa (`🎙️ Te escucho, dime la orden...`).
  - La siguiente frase que pronuncies se tomará de inmediato como la instrucción a ejecutar.
* **Privacidad y filtrado de conversaciones:**  
  Si hablas con otra persona o hay ruido ambiental y no mencionas "Capri", el audio se descarta en silencio sin interrumpir tu trabajo ni abrir ventanas.

### Control Manual y Atajos
1. **Botón Micrófono `🎙️`**:
   - Color cian/neón constante: Micrófono en escucha continua esperando la palabra *"Capri"*.
   - Pulso magenta/rojo: Voz activa detectada y procesándose.
   - Clic en el botón: Activa inmediatamente la captura de una orden directa (sin necesidad de decir "Capri").
2. **Atajo Global**: Presiona <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>M</kbd> en cualquier momento para activar o pausar el micrófono.
3. **Bandeja del Sistema**: Clic derecho en el icono de la bandeja $\rightarrow$ *🎙️ Reconocimiento por voz*.

### Arquitectura de Escucha Continua
* **VAD (Voice Activity Detection)**: Análisis en tiempo real de volumen RMS para detectar habla humana. En momentos de silencio o ruido de fondo, el consumo de CPU es imperceptible y no se realizan peticiones de red.
* **Detección Automática de Pausa**: Tras ~750ms de pausa al terminar de hablar, Capri segmenta el audio y procesa la frase.
* **STT Multimodal de Ultra Baja Latencia**: Transcripción rápida mediante Gemini Flash / Web Speech para responder casi instantáneamente.

### Ejemplos de comandos hablados
* 🗣️ *"Abre Chrome"* $\rightarrow$ Inicia Google Chrome.
* 🗣️ *"Abre YouTube en Brave"* $\rightarrow$ Abre YouTube en tu navegador Brave.
* 🗣️ *"Actualiza todos los paquetes"* $\rightarrow$ Abre Kitty y actualiza espejos + pacman + AUR + Flatpaks.
* 🗣️ *"Conéctame a PC2"* $\rightarrow$ Lanza sesión RDP a tu máquina remota en Tailscale.
* 🗣️ *"Conecta Tailscale"* $\rightarrow$ Levanta la conexión VPN.
* 🗣️ *"Abre lazygit"* $\rightarrow$ Abre la interfaz interactiva de Git en Kitty.
* 🗣️ *"Abre archify en agy"* $\rightarrow$ Abre el proyecto en Antigravity IDE.
* 🗣️ *"Abre el proyecto ciccorp b2b"* $\rightarrow$ Lanza el proyecto en Antigravity IDE.
* 🗣️ *"Selector de proyectos"* $\rightarrow$ Abre el menú Wofi de proyectos recientes.
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

