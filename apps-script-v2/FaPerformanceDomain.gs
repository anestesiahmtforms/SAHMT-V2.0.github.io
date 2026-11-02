var FaPerformanceDomain = (() => {
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

  // fa-performance/domain.js
  var domain_exports = {};
  __export(domain_exports, {
    FA_PROJECT: () => FA_PROJECT,
    projectFaPerformance: () => projectFaPerformance
  });
  var FA_PROJECT = "sahmt-17a16";
  var time = (v) => typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  var normalized = (v) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
  var safeId = (v) => typeof v === "string" && /^[A-Za-z0-9_.@+:%-]{1,200}$/.test(v);
  var date = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + "T12:00:00Z"));
  function projectFaPerformance({ events, signatures, requests, profiles, contacts = [], previousAwards, effectiveFrom, cutoffDay, now, complete }) {
    if (complete !== true) throw Error("FA_INPUT_INCOMPLETE");
    if (!Number.isFinite(effectiveFrom) || effectiveFrom <= 0 || !Number.isFinite(now) || now < effectiveFrom || !date(cutoffDay)) throw Error("FA_ACTIVATION_REQUIRED");
    const today = new Date(now - 3 * 36e5).toISOString().slice(0, 10);
    const eligible = profiles.filter((p) => p.id === p.uid && safeId(p.uid) && p.active === true && p.access === true);
    const old = new Map(previousAwards.map((a) => [a.id, a])), desired = /* @__PURE__ */ new Map(), ledger = [];
    let pending = 0;
    const after = (v) => Number.isFinite(time(v)) && time(v) >= effectiveFrom && time(v) <= now;
    const make = (sourceType, sourceId, uid, points, extra = {}) => ({ id: sourceType + "_" + encodeURIComponent(sourceId) + "_" + uid, uid, sourceType, sourceId, points, sourceProjectId: FA_PROJECT, ...extra });
    const hold = (sourceType, sourceId) => {
      for (const a of old.values()) if (a.sourceType === sourceType && a.sourceId === sourceId) desired.set(a.id, a);
    };
    const add = (a) => desired.set(a.id, a);
    for (const a of old.values()) if (a.sourceType === "CHECKLIST") add(a);
    const days = new Set([...desired.values()].filter((a) => a.sourceType === "CHECKLIST").map((a) => a.sourceId));
    for (const s of [...signatures].sort((a, b) => time(a.signedAt) - time(b.signedAt) || String(a.id).localeCompare(String(b.id)))) {
      if (!date(s.date) || s.date < cutoffDay || s.date > today || days.has(s.date)) continue;
      const r = requests.find((r2) => r2.finalSignatureId === s.id && r2.day === s.date && r2.signerUid === s.signerUid && r2.status === "VALIDATED" && after(r2.requestedAt) && after(r2.validatedAt));
      if (!r || s.declaration !== true || s.snapshotValid !== true || !after(s.signedAt) || !after(s.acknowledgedAt) || !safeId(s.signerUid) || !safeId(s.responsibleUid)) {
        continue;
      }
      if (!eligible.some((p) => p.uid === s.signerUid) || !eligible.some((p) => p.uid === s.responsibleUid)) {
        pending++;
        continue;
      }
      const extra = { date: s.date, signatureId: s.id, sourceAt: time(s.signedAt) };
      add(make("CHECKLIST", s.date, s.signerUid, s.signerUid === s.responsibleUid ? 0 : 1, extra));
      if (s.signerUid !== s.responsibleUid) add(make("CHECKLIST", s.date, s.responsibleUid, -1, extra));
      days.add(s.date);
    }
    for (const e of events) {
      if (!safeId(e.id)) throw Error("FA_SOURCE_ID_INVALID");
      if (!after(e.createdAt) || !date(e.date) || e.date < cutoffDay || e.date > today || normalized(e.eventType) !== "ATRASO" || e.active === false || ["CANCELLED", "CANCELED", "CANCELADO", "EXCLUIDO", "DELETED"].includes(normalized(e.status))) continue;
      const sigla = normalized(e.memberSigla);
      let matches = eligible.filter((p) => normalized(p.sigla) === sigla);
      if (!matches.length) {
        const directory = contacts.filter((c) => c.active === true && normalized(c.sigla) === sigla);
        if (directory.length === 1 && directory[0].email) {
          const email = String(directory[0].email).trim().toLowerCase();
          matches = eligible.filter((p) => String(p.email || "").trim().toLowerCase() === email && (!p.sigla || normalized(p.sigla) === sigla));
        }
      }
      const previous = [...old.values()].filter((a) => a.sourceType === "ATRASO" && a.sourceId === e.id && a.points !== 0);
      const m = e.delayMultiple, validMultiple = (typeof m === "number" && Number.isInteger(m) || typeof m === "string" && /^[0-6]$/.test(m)) && Number(m) >= 0 && Number(m) <= 6;
      if (!sigla || matches.length !== 1 || !validMultiple || previous.some((a) => a.memberSigla === sigla && a.uid !== matches[0].uid)) {
        pending++;
        hold("ATRASO", e.id);
        continue;
      }
      add(make("ATRASO", e.id, matches[0].uid, Number(m) === 0 ? -0.5 : -Number(m), { date: e.date, memberSigla: sigla, multiple: Number(m), sourceAt: time(e.createdAt) }));
    }
    for (const a of old.values()) if (!desired.has(a.id)) add({ ...a, points: 0 });
    const awards = [];
    for (const [id, a] of desired) {
      const before = old.get(id), changed = !before || before.points !== a.points;
      const version = changed ? (before?.awardVersion || 0) + 1 : before.awardVersion;
      const row = { ...a, awardVersion: version, updatedAt: changed ? now : before.updatedAt };
      awards.push(row);
      if (changed) ledger.push({ id: id + "_v" + version, awardId: id, uid: a.uid, sourceType: a.sourceType, sourceId: a.sourceId, date: a.date, delta: a.points - (before?.points || 0), pointsBefore: before?.points || 0, pointsAfter: a.points, awardVersion: version, createdAt: now });
    }
    const totals = Object.fromEntries(eligible.map((p) => [p.uid, 0]));
    for (const a of awards) if (Object.hasOwn(totals, a.uid)) totals[a.uid] += a.points;
    return { awards, ledger, totals, maxPerformance: Math.max(0, ...Object.values(totals)), pending };
  }
  return __toCommonJS(domain_exports);
})();
