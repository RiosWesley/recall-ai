"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("api", {
  // ── Import ──────────────────────────────────────────────────────────────────
  importChat(filePath) {
    return electron.ipcRenderer.invoke("import:chat", filePath);
  },
  openFileDialog() {
    return electron.ipcRenderer.invoke("import:file-dialog");
  },
  onImportProgress(cb) {
    const listener = (_event, progress) => cb(progress);
    electron.ipcRenderer.on("import:progress", listener);
    return () => electron.ipcRenderer.off("import:progress", listener);
  },
  // ── Chats ───────────────────────────────────────────────────────────────────
  getChats() {
    return electron.ipcRenderer.invoke("chats:list");
  },
  deleteChat(chatId) {
    return electron.ipcRenderer.invoke("chats:delete", chatId);
  },
  // ── Window controls ─────────────────────────────────────────────────────────
  windowMinimize() {
    electron.ipcRenderer.send("window:minimize");
  },
  windowMaximize() {
    electron.ipcRenderer.send("window:maximize");
  },
  windowClose() {
    electron.ipcRenderer.send("window:close");
  }
});
