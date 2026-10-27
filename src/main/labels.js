'use strict';

// El menú del tray (y el menú desplegado al hacer clic derecho), 100% en Español.
// Diseñado para Linux (CachyOS / Niri / Noctalia).

const TRAY = {
  es: {
    name: 'Español',
    title: 'Capri — Construct',
    modeOnlyView: 'OnlyView Version',
    modeFull: 'Full Version',
    chat: 'Hablar con Capri',
    provider: 'Proveedor de IA',
    providerGemini: 'Google Gemini Flash',
    providerOllama: 'Llama 3 (Ollama local)',
    commands: 'Comandos rápidos',
    cmdBrave: 'Abrir Brave Browser',
    cmdDolphin: 'Abrir Dolphin Files',
    teleport: 'Teletransportar',
    satellite: 'Mirar el satélite',
    possessNow: 'Poseer ventana activa',
    celebrate: 'Celebración / Victoria',
    intro: 'Animación de inicio (Intro)',
    // sleep: 'Dormir / Despertar',
    compact: 'Modo recuadro pequeño (Widget)',
    show: 'Sacar del biochip',
    hide: 'Guardar en biochip',
    size: 'Tamaño',
    small: 'Pequeña (45%)',
    medium: 'Normal (60%)',
    large: 'Grande (80%)',
    huge: 'Gigante (100%)',
    sound: 'Sonido',
    mute: 'Silenciar',
    soundsDir: 'Abrir carpeta de sonidos propios',
    screen: 'Pantalla',
    wander: 'Deambular cuando esté libre',
    possess: 'Poseer ventanas aleatoriamente',
    startup: 'Iniciar al encender el sistema',
    quit: 'Salir',
  },
};

module.exports = { TRAY, LANGS: ['es'] };
