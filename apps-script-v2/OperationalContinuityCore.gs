var SahmtContinuity = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/remote-continuity-reconciliation.js
  var remote_continuity_reconciliation_exports = {};
  __export(remote_continuity_reconciliation_exports, {
    reconcileContinuityOperation: () => reconcileContinuityOperation
  });

  // src/schedule-release.js
  var memberPattern = /^(?:[A-Z]{2}|L2)$/;
  var tokenPattern = /^(?:DC|[A-Z]{2}|L2)(?:[/-](?:DC|[A-Z]{2}|L2))*$/;
  function updateScheduleReleaseState(currentSiglas, { sigla, marked, groupSiglas = [], tokenSigla = sigla } = {}) {
    if (!Array.isArray(currentSiglas) || !memberPattern.test(sigla || "") || typeof marked !== "boolean" || !tokenPattern.test(tokenSigla || "") || !Array.isArray(groupSiglas) || groupSiglas.length > 30 || groupSiglas.some((value) => !memberPattern.test(value))) {
      throw new Error("Marca\xE7\xE3o de libera\xE7\xE3o inv\xE1lida.");
    }
    const next = [...new Set(currentSiglas.filter((value) => typeof value === "string" && tokenPattern.test(value)))];
    const tokenWasMarked = next.includes(tokenSigla);
    const memberWasMarked = next.includes(sigla);
    if (marked && !memberWasMarked) next.push(sigla);
    if (!marked && memberWasMarked) next.splice(next.indexOf(sigla), 1);
    const members = groupSiglas.length ? groupSiglas : [sigla];
    const tokenShouldBeMarked = members.every((member) => next.includes(member));
    if (tokenShouldBeMarked && !next.includes(tokenSigla)) next.push(tokenSigla);
    if (!tokenShouldBeMarked && next.includes(tokenSigla)) next.splice(next.indexOf(tokenSigla), 1);
    return { siglas: next, changed: memberWasMarked !== marked || tokenShouldBeMarked !== tokenWasMarked };
  }
  function updateScheduleReleaseTimes(currentTimes = {}, previousSiglas = [], nextSiglas = [], occurredAt) {
    const times = {};
    for (const sigla of nextSiglas) {
      if (Number.isFinite(currentTimes?.[sigla]) && currentTimes[sigla] > 0) times[sigla] = currentTimes[sigla];
      else if (!previousSiglas.includes(sigla) && Number.isFinite(occurredAt) && occurredAt > 0) times[sigla] = occurredAt;
    }
    return times;
  }

  // src/provisional-channel-contract.js
  var CHANNEL_COLLECTIONS = Object.freeze(["events", "labels", "checklists", "scheduleReleases"]);
  var CHANNEL_PERMISSIONS = Object.freeze(["admin", "scheduleRead", "scheduleWrite", "checklistSign", "eventsRead", "eventsWrite", "labelsRead", "labelsWrite", "labelsManage", "checklistRead", "checklistWrite"]);
  var CHANNEL_GRANT_MS = 24 * 60 * 60 * 1e3;
  var channelError = (code, status = 400) => Object.assign(new Error(code), { code, status });
  var requireValue = (condition, code, status) => {
    if (!condition) throw channelError(code, status);
  };
  var validId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  function validDay(day) {
    return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number(day.slice(0, 4)) > 0 && Number.isFinite(Date.parse(day + "T00:00:00Z")) && (/* @__PURE__ */ new Date(day + "T00:00:00Z")).toISOString().slice(0, 10) === day;
  }
  var channelDay = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  function channelActorFromProfile(uid, profile, now = Date.now()) {
    requireValue(validId(uid) && profile && typeof profile === "object" && !Array.isArray(profile), "CHANNEL_PROFILE_INVALID", 403);
    const permissions = {};
    const admin = profile.role === "administrador_app" || profile.permissions?.admin === true;
    for (const key of CHANNEL_PERMISSIONS) permissions[key] = admin || profile.permissions?.[key] === true;
    return {
      uid,
      displayName: String(profile.displayName || "").slice(0, 120),
      sigla: String(profile.sigla || "").trim().toUpperCase().slice(0, 20),
      active: profile.active === true,
      access: profile.access === true,
      permissions,
      verifiedAt: now,
      expiresAt: now + CHANNEL_GRANT_MS
    };
  }
  function channelCan(actor, permission) {
    return actor?.active === true && actor?.access === true && (actor.permissions?.admin === true || actor.permissions?.[permission] === true);
  }
  function canWriteChannel(collection, actor) {
    return CHANNEL_COLLECTIONS.includes(collection) && channelCan(actor, { events: "eventsWrite", labels: "labelsWrite", checklists: "checklistWrite", scheduleReleases: "scheduleWrite" }[collection]);
  }
  var fields = {
    scheduleReleases: ["day", "sigla", "marked", "groupSiglas", "tokenSigla", "occurredAt", "expectedVersion"],
    events: ["date", "memberSigla", "scheduleSigla", "memberStatus", "eventType", "description", "delayMultiple", "substitute", "shift", "payer", "creditor", "amountToPay", "status", "createdByName", "updatedByName"],
    labels: ["date", "patientName", "procedureCode", "encounterCode", "type", "amount", "insurance", "creditor", "staffSiglas", "consultation", "status", "createdByName", "updatedByName"],
    checklists: ["date", "stationId", "condition", "status", "occurrence", "responsibleUid", "responsibleName", "responsibleEmail", "createdByName"]
  };
  var text = (value, max, required = false) => typeof value === "string" && value.length <= max && (!required || Boolean(value.trim()));
  function normalizeChannelSubmission(input, actor, now = Date.now()) {
    requireValue(input && Object.keys(input).every((key) => ["collection", "requestId", "data", "createdAt"].includes(key)) && CHANNEL_COLLECTIONS.includes(input.collection) && validId(input.requestId), "CHANNEL_RECORD_INVALID");
    requireValue(canWriteChannel(input.collection, actor), "CHANNEL_WRITE_DENIED", 403);
    const data = input.data, collection = input.collection, day = collection === "scheduleReleases" ? data?.day : data?.date;
    requireValue(data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).every((key) => fields[collection].includes(key)) && validDay(day), "CHANNEL_RECORD_INVALID");
    const today = channelDay(now);
    requireValue(day <= today && Date.parse(today) - Date.parse(day) <= 7 * 864e5, "CHANNEL_DATE_INVALID");
    for (const [key, value] of Object.entries(data)) requireValue(value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e13 || text(value, ["description", "occurrence"].includes(key) ? 2e3 : 160) || ["staffSiglas", "groupSiglas"].includes(key) && Array.isArray(value) && value.length <= 30 && value.every((item) => /^(?:[A-Z]{2}|L2)$/.test(item)), "CHANNEL_FIELD_INVALID");
    if (collection === "scheduleReleases") {
      try {
        updateScheduleReleaseState([], data);
      } catch {
        throw channelError("CHANNEL_RELEASE_INVALID");
      }
      requireValue((data.expectedVersion === void 0 || Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0) && Number.isSafeInteger(data.occurredAt) && data.occurredAt > 0 && data.occurredAt <= now + 6e4, "CHANNEL_RELEASE_INVALID");
    }
    if (collection === "checklists") requireValue(validId(data.stationId) && ["SIM", "NAO"].includes(data.condition) && text(data.occurrence, 500) && (data.condition !== "SIM" || data.occurrence === "") && (data.condition !== "NAO" || data.occurrence.trim()) && data.status === (data.condition === "SIM" ? "COMPLETED" : "MAINTENANCE") && ["responsibleUid", "responsibleName", "responsibleEmail"].every((key) => data[key] === null), "CHANNEL_CHECKLIST_INVALID");
    if (collection === "labels") requireValue(text(data.patientName, 160, true) && text(data.encounterCode, 80, true) && text(data.procedureCode, 80) && text(data.insurance, 120) && ["Particular", "Complementa\xE7\xE3o", "Conv\xEAnio", "Consulta Pr\xE9-anest\xE9sica", "SADT"].includes(data.type) && ["Caixa", "Plant\xE3o", "Plant\xE3o/Caixa"].includes(data.creditor) && (data.amount === null || Number.isFinite(data.amount) && data.amount >= 0) && Array.isArray(data.staffSiglas) && data.staffSiglas.length <= 20 && (data.creditor === "Caixa" ? data.staffSiglas.length === 0 : data.staffSiglas.length > 0) && data.consultation === (data.type === "Consulta Pr\xE9-anest\xE9sica") && data.status === "CONFIRMED", "CHANNEL_LABEL_INVALID");
    if (collection === "events") requireValue(text(data.eventType, 160, true) && text(data.description, 2e3) && (data.delayMultiple === null || Number.isFinite(data.delayMultiple) && data.delayMultiple >= 0) && Number.isFinite(data.amountToPay) && data.amountToPay >= 0 && ["memberSigla", "scheduleSigla", "memberStatus", "substitute", "shift", "payer", "creditor", "status"].every((key) => text(data[key], 160)), "CHANNEL_EVENT_INVALID");
    const normalized = collection === "scheduleReleases" ? { ...data } : collection === "checklists" ? { ...data, createdByName: actor.displayName } : { ...data, createdByName: actor.displayName, updatedByName: actor.displayName };
    const createdAt = Number.isSafeInteger(input.createdAt) && input.createdAt > 0 && input.createdAt <= now + 6e4 ? input.createdAt : now;
    const record = {
      ...normalized,
      date: day,
      id: input.requestId,
      clientMutationId: input.requestId,
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
      createdByName: actor.displayName,
      updatedByName: actor.displayName,
      createdAt: new Date(createdAt).toISOString(),
      updatedAt: new Date(now).toISOString(),
      receivedAt: now,
      version: 1,
      active: true,
      provisionalShared: true,
      pendingFirestore: true,
      pendingSync: collection === "checklists"
    };
    return { collection, requestId: input.requestId, data: normalized, record };
  }

  // src/remote-continuity-reconciliation.js
  var canonical = (value) => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]" : value && typeof value === "object" ? "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value);
  function reconcileContinuityOperation(operation, profile, { now = Date.now(), getDocument, commit }) {
    const conflict = (code) => ({ state: "conflict", code });
    if (profile?.uid !== operation?.uid || !profile.active || !profile.access) return conflict("CONTINUITY_ACCESS_DENIED");
    const actor = channelActorFromProfile(operation.uid, profile, now);
    if (!canWriteChannel(operation.collection, actor)) return conflict("CONTINUITY_ACCESS_DENIED");
    let normalized;
    try {
      normalized = normalizeChannelSubmission({ collection: operation.collection, requestId: operation.requestId, data: operation.data, createdAt: operation.createdAt }, actor, operation.createdAt);
    } catch {
      return conflict("CONTINUITY_OPERATION_INVALID");
    }
    const path = operation.collection === "scheduleReleases" ? "scheduleDays/" + operation.day : operation.collection + "/" + operation.requestId;
    const prior = getDocument(path), writes = [];
    let record;
    if (operation.collection === "scheduleReleases") {
      if (!prior) return conflict("CONTINUITY_SCHEDULE_MISSING");
      const data = prior.data, current = data.highlights?.siglas || [], changed = updateScheduleReleaseState(current, operation.data);
      if (!changed.changed) return { state: "confirmed", code: "CONTINUITY_ALREADY_COMMITTED", path, record: { ...data, id: operation.day } };
      if (!Number.isSafeInteger(operation.data.expectedVersion) || operation.data.expectedVersion !== (data.version || 0)) return conflict("CONTINUITY_SCHEDULE_CONFLICT");
      record = { ...data, id: operation.day, version: (data.version || 0) + 1, updatedByUid: operation.uid, updatedAt: new Date(now).toISOString(), highlights: { ...data.highlights, siglas: changed.siglas, releaseTimes: updateScheduleReleaseTimes(data.highlights?.releaseTimes, current, changed.siglas, operation.data.occurredAt) } };
      writes.push({ path, record, currentDocument: { updateTime: prior.updateTime } });
    } else {
      if (prior) {
        const data = prior.data, matches = data.id === operation.requestId && data.clientMutationId === operation.requestId && data.createdByUid === operation.uid && Object.entries(operation.data).filter(([key]) => !["createdByName", "updatedByName"].includes(key)).every(([key, value]) => canonical(data[key]) === canonical(value));
        return matches ? { state: "confirmed", code: "CONTINUITY_ALREADY_COMMITTED", path, record: data } : conflict("CONTINUITY_RECORD_CONFLICT");
      }
      record = { ...normalized.data, id: operation.requestId, clientMutationId: operation.requestId, createdByUid: operation.uid, updatedByUid: operation.uid, createdAt: new Date(operation.createdAt).toISOString(), updatedAt: new Date(now).toISOString(), active: true, version: 1 };
      writes.push({ path, record, currentDocument: { exists: false } });
      if (operation.collection === "events" && operation.data.scheduleSigla) {
        const schedulePath = "scheduleDays/" + operation.day, schedule = getDocument(schedulePath);
        if (schedule) {
          const data = schedule.data, marker = `EVENTO:${operation.data.scheduleSigla.toUpperCase()}:${operation.data.memberSigla?.toUpperCase() || "-"}:${operation.requestId}`;
          writes.push({ path: schedulePath, currentDocument: { updateTime: schedule.updateTime }, record: { ...data, highlights: { ...data.highlights, events: [.../* @__PURE__ */ new Set([...data.highlights?.events || [], marker])] }, version: (data.version || 0) + 1, updatedAt: new Date(now).toISOString(), updatedByUid: operation.uid } });
        }
      }
    }
    commit(writes);
    return { state: "confirmed", code: "CONTINUITY_COMMITTED", path, record };
  }
  return __toCommonJS(remote_continuity_reconciliation_exports);
})();
