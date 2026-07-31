(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ResinIQSyncStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KEYS = Object.freeze({
    settings: "resinIQ.lineSync.settings.v1",
    metadata: "resinIQ.lineSync.metadata.v1",
    outbox: "resinIQ.lineSync.outbox.v1",
    backups: "resinIQ.lineSync.backups.v1"
  });

  function clone(value){ return JSON.parse(JSON.stringify(value)); }

  function read(storage, key, fallback){
    try{
      const raw = storage.getItem(key);
      if (!raw) return clone(fallback);
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : clone(fallback);
    }catch(error){ return clone(fallback); }
  }

  function write(storage, key, value){
    try{
      storage.setItem(key, JSON.stringify(value));
      return { ok: true };
    }catch(error){ return { ok: false, error }; }
  }

  function createStore(storage){
    const defaults = {
      settings: {
        deviceId: "",
        deviceLabel: "",
        selectedWorkspaceId: "",
        disconnectedWorkspaceIds: [],
        workspaceCache: [],
        pendingWorkspaceCreation: null
      },
      metadata: { workspaces: {}, lastSyncAt: "" },
      outbox: { activeJobs: {}, setupOperations: [] },
      backups: { items: [] }
    };

    function getSettings(){ return read(storage, KEYS.settings, defaults.settings); }
    function saveSettings(value){ return write(storage, KEYS.settings, value); }
    function getMetadata(){ return read(storage, KEYS.metadata, defaults.metadata); }
    function saveMetadata(value){ return write(storage, KEYS.metadata, value); }
    function getOutbox(){ return read(storage, KEYS.outbox, defaults.outbox); }
    function saveOutbox(value){ return write(storage, KEYS.outbox, value); }

    function queueActiveJob(workspaceId, pending){
      const outbox = getOutbox();
      outbox.activeJobs[workspaceId] = clone(pending);
      return saveOutbox(outbox);
    }
    function clearActiveJob(workspaceId, operationId){
      const outbox = getOutbox();
      if (!outbox.activeJobs[workspaceId]) return { ok: true };
      if (operationId && outbox.activeJobs[workspaceId].operationId !== operationId) return { ok: true };
      delete outbox.activeJobs[workspaceId];
      return saveOutbox(outbox);
    }
    function queueSetupOperation(operation){
      const outbox = getOutbox();
      const index = outbox.setupOperations.findIndex(item=>item.operationId === operation.operationId);
      if (index >= 0) outbox.setupOperations[index] = clone(operation);
      else outbox.setupOperations.push(clone(operation));
      return saveOutbox(outbox);
    }
    function clearSetupOperation(operationId){
      const outbox = getOutbox();
      outbox.setupOperations = outbox.setupOperations.filter(item=>item.operationId !== operationId);
      return saveOutbox(outbox);
    }
    function addBackup(backup){
      const backups = read(storage, KEYS.backups, defaults.backups);
      backups.items.unshift(clone(backup));
      backups.items = backups.items.slice(0, 10);
      return write(storage, KEYS.backups, backups);
    }
    function pendingCount(){
      const outbox = getOutbox();
      return Object.keys(outbox.activeJobs).length + outbox.setupOperations.length;
    }

    return {
      getSettings,
      saveSettings,
      getMetadata,
      saveMetadata,
      getOutbox,
      saveOutbox,
      queueActiveJob,
      clearActiveJob,
      queueSetupOperation,
      clearSetupOperation,
      addBackup,
      pendingCount
    };
  }

  return { KEYS, createStore };
});
