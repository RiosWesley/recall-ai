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
  // ── Models ──────────────────────────────────────────────────────────────────
  checkModels() {
    return electron.ipcRenderer.invoke("models:check");
  },
  downloadModel(key) {
    return electron.ipcRenderer.invoke("models:download", key);
  },
  onModelProgress(cb) {
    const listener = (_event, progress) => cb(progress);
    electron.ipcRenderer.on("models:progress", listener);
    return () => electron.ipcRenderer.off("models:progress", listener);
  },
  selectModelFile() {
    return electron.ipcRenderer.invoke("models:select-file");
  },
  // ── Search ──────────────────────────────────────────────────────────────────
  search(query, options) {
    return electron.ipcRenderer.invoke("search:query", query, options);
  },
  // ── RAG ─────────────────────────────────────────────────────────────────────
  askRAG(question, options) {
    return electron.ipcRenderer.invoke("rag:query", question, options);
  },
  onRAGToken(cb) {
    const listener = (_event, token) => cb(token);
    electron.ipcRenderer.on("rag:token", listener);
    return () => electron.ipcRenderer.off("rag:token", listener);
  },
  onRAGDone(cb) {
    const listener = (_event, response) => cb(response);
    electron.ipcRenderer.on("rag:done", listener);
    return () => electron.ipcRenderer.off("rag:done", listener);
  },
  // ── Settings ────────────────────────────────────────────────────────────────
  getSettings() {
    return electron.ipcRenderer.invoke("settings:get");
  },
  updateSettings(partial) {
    return electron.ipcRenderer.invoke("settings:update", partial);
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
