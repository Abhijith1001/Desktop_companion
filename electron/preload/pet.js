// Narrow bridge for the pet window: only these channels can be used.
const { contextBridge, ipcRenderer } = require('electron');

const SEND = new Set(['pet:set-ignore', 'pet:drag-start', 'pet:drag-end', 'pet:menu', 'pet:ready', 'alert:shown', 'alert:action', 'pet:reduced-motion', 'pet:hitbox']);
const INVOKE = new Set(['pet:hint', 'pet:drop']);
const RECEIVE = new Set(['pet:state', 'pet:character', 'pet:options', 'pet:say', 'alert', 'alert:clear', 'pet:chime', 'pet:drag-motion', 'pet:impact-effect', 'pet:impact-sound', 'pet:angry-sound']);

contextBridge.exposeInMainWorld('pet', {
  send: (ch, payload) => { if (SEND.has(ch)) ipcRenderer.send(ch, payload); },
  invoke: (ch, payload) => (INVOKE.has(ch) ? ipcRenderer.invoke(ch, payload) : Promise.reject(new Error('blocked'))),
  on: (ch, fn) => { if (RECEIVE.has(ch)) ipcRenderer.on(ch, (_e, p) => fn(p)); },
});
