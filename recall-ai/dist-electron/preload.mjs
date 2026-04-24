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
  onRAGStep(cb) {
    const listener = (_event, step) => cb(step);
    electron.ipcRenderer.on("rag:step", listener);
    return () => electron.ipcRenderer.off("rag:step", listener);
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
  // ── People & Mentions ───────────────────────────────────────────────────────
  getPendingMentions() {
    return electron.ipcRenderer.invoke("mentions:get_pending");
  },
  getPeople() {
    return electron.ipcRenderer.invoke("mentions:get_people");
  },
  getRelations() {
    return electron.ipcRenderer.invoke("mentions:get_relations");
  },
  resolveMention(mentionId, action, personId) {
    return electron.ipcRenderer.invoke("mentions:resolve", mentionId, action, personId);
  },
  onMentionDetected(cb) {
    const listener = (_event, mention) => cb(mention);
    electron.ipcRenderer.on("ingest:mention_detected", listener);
    return () => electron.ipcRenderer.off("ingest:mention_detected", listener);
  },
  // ── Map-Reduce (Phase 7) ─────────────────────────────────────────────────────
  getMapReduceStatus() {
    return electron.ipcRenderer.invoke("mapreduce:status");
  },
  runMapReduceNow() {
    return electron.ipcRenderer.invoke("mapreduce:run_now");
  },
  /** Returns AI-extracted tags and key memories for a specific person. */
  getPersonKnowledge(personId) {
    return electron.ipcRenderer.invoke("people:get_knowledge", personId);
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
