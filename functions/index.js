import {createHash} from 'node:crypto';
import {initializeApp} from 'firebase-admin/app';
import {FieldValue, getFirestore} from 'firebase-admin/firestore';
import {onDocumentWritten} from 'firebase-functions/v2/firestore';
import {HttpsError, onCall} from 'firebase-functions/v2/https';
import {buildReportSyncJob} from './report-sync-queue.js';

initializeApp({projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT});
const db = getFirestore();
const REGION = 'southamerica-east1';
const MAX_STATIONS = 200;
const MAX_DAILY_RECORDS = 1000;

function saoPauloDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({type, value}) => [type, value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function weekdayFor(day) {
  const value = new Intl.DateTimeFormat('pt-BR', {weekday: 'long', timeZone: 'UTC'})
    .format(new Date(`${day}T12:00:00Z`));
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/-feira/g, '').trim().split(/\s+/)[0];
}

function normalized(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function siglasIn(value = '', weekday) {
  const tokens = String(value).split('(')[0].toUpperCase().match(/(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*/g) || [];
  return [...new Set(tokens.flatMap((token) => token.split(/[/-]/).flatMap((sigla) => sigla === 'DC' ? (dcAliasesByWeekday[weekday] || dcFallback) : [sigla])))];
}

function vacationSiglas(schedule, vacations, weekday) {
  const result = new Set(siglasIn(schedule.vacationLabel || '', weekday));
  for (const vacation of vacations) {
    if (vacation.active !== true) continue;
    const values = Array.isArray(vacation.siglas) && vacation.siglas.length ? vacation.siglas : [vacation.label || ''];
    for (const value of values) siglasIn(value, weekday).forEach((sigla) => result.add(sigla));
  }
  return result;
}

function eventMemberSiglas(event, contacts, weekday) {
  const value = String(event.memberStatus || '');
  const member = normalized(value);
  const matched = contacts.filter((contact) => normalized(contact.name) === member);
  if (matched.length === 1 && matched[0].sigla) return siglasIn(matched[0].sigla, weekday);
  if (matched.length > 1) return null;
  if (/^(?:DC|L2|[A-Z]{2})(?:[/-](?:DC|L2|[A-Z]{2}))*$/.test(value.trim().toUpperCase())) return siglasIn(value, weekday);
  return null;
}

function selectResponsible({schedule, day, vacations, events, contacts}) {
  const weekday = weekdayFor(day);
  const vacation = vacationSiglas(schedule, vacations, weekday);
  const replaced = new Set();
  for (const event of events) {
    if (event.date !== day || event.active !== true || !String(event.substitute || '').trim()) continue;
    const type = normalized(event.eventType);
    if (type === 'ATRASO' || normalized(event.memberStatus) === 'SUPORTE') continue;
    const affected = eventMemberSiglas(event, contacts, weekday);
    if (!affected) return {ok: false, reason: 'Há uma substituição sem membro identificável na escala.'};
    affected.forEach((sigla) => replaced.add(sigla));
  }
  const positions = Array.isArray(schedule.positions) ? schedule.positions : [];
  for (const [index, item] of positions.entries()) {
    const token = typeof item === 'string' ? item : item?.sigla || item?.name || item?.label || '';
    const available = siglasIn(token, weekday).filter((sigla) => !vacation.has(sigla) && !replaced.has(sigla));
    if (!available.length) continue;
    return {ok: true, sigla: available[0], position: index + 1};
  }
  return {ok: false, reason: 'Não há uma pessoa disponível na primeira posição da escala.'};
}

async function readSnapshot(transaction, day, uid) {
  const profileRef = db.doc(`users/${uid}`);
  const scheduleRef = db.doc(`scheduleDays/${day}`);
  const stationsQuery = db.collection('stations').where('active', '==', true).orderBy('order', 'asc').limit(MAX_STATIONS + 1);
  const vacationsQuery = db.collection('vacations').where('active', '==', true).where('start', '<=', day).where('end', '>=', day).orderBy('start', 'asc').limit(101);
  const eventsQuery = db.collection('events').where('active', '==', true).where('date', '==', day).limit(201);
  const contactsQuery = db.collection('contacts').where('active', '==', true).limit(201);
  const recordsQuery = db.collection('checklists').where('date', '==', day).orderBy('createdAt', 'desc').limit(MAX_DAILY_RECORDS + 1);
  const [profileDoc, scheduleDoc, stationDocs, vacationDocs, eventDocs, contactDocs, recordDocs] = await Promise.all([
    transaction.get(profileRef), transaction.get(scheduleRef), transaction.get(stationsQuery),
    transaction.get(vacationsQuery), transaction.get(eventsQuery), transaction.get(contactsQuery), transaction.get(recordsQuery)
  ]);
  if (!profileDoc.exists) throw new HttpsError('permission-denied', 'Perfil SAHMT não encontrado.');
  const profile = profileDoc.data();
  const hasSignPermission = profile.role === 'administrador_app' || profile.permissions?.admin === true || profile.permissions?.checklistSign === true;
  if (profile.uid !== uid || profile.active !== true || profile.access !== true || !hasSignPermission) {
    throw new HttpsError('permission-denied', 'Seu perfil não tem permissão para assinar o Checklist.');
  }
  if (!scheduleDoc.exists) throw new HttpsError('failed-precondition', 'A escala deste dia não está disponível.');
  if (stationDocs.size > MAX_STATIONS || vacationDocs.size > 100 || eventDocs.size > 200 || contactDocs.size > 200 || recordDocs.size > MAX_DAILY_RECORDS) {
    throw new HttpsError('resource-exhausted', 'O relatório excede o limite de dados que pode ser conferido com segurança.');
  }

  const schedule = scheduleDoc.data();
  const vacations = vacationDocs.docs.map((item) => item.data());
  const events = eventDocs.docs.map((item) => item.data());
  const contacts = contactDocs.docs.map((item) => item.data());
  const stations = stationDocs.docs.map((item) => ({id: item.id, ...item.data()}))
    .filter((item) => item.start <= day && (!item.end || item.end >= day));
  if (!stations.length) throw new HttpsError('failed-precondition', 'Não há estações vigentes para este Checklist.');
  const responses = new Map();
  for (const item of recordDocs.docs) {
    const value = item.data();
    if (!responses.has(value.stationId)) responses.set(value.stationId, {id: item.id, ...value});
  }
  const selection = selectResponsible({schedule, day, vacations, events, contacts});
  if (!selection.ok) throw new HttpsError('failed-precondition', selection.reason);
  const profileMatches = await transaction.get(db.collection('users').where('sigla', '==', selection.sigla).limit(2));
  const profiles = profileMatches.docs.map((item) => item.data());
  if (profiles.length !== 1 || profiles[0].active !== true || profiles[0].access !== true || !profiles[0].uid) {
    throw new HttpsError('failed-precondition', `Não há um perfil V2 único e ativo para a sigla ${selection.sigla}.`);
  }
  const contactMatches = contacts.filter((contact) => normalized(contact.sigla) === selection.sigla && contact.active === true);
  const responsible = {
    ...selection,
    responsibleUid: profiles[0].uid,
    responsibleName: contactMatches.length === 1 ? contactMatches[0].name : profiles[0].displayName,
    responsibleEmail: contactMatches.length === 1 ? contactMatches[0].email || '' : profiles[0].email || ''
  };

  const entries = stations.map((station) => {
    const record = responses.get(station.id) || null;
    return {
      stationId: station.id,
      stationName: station.name || station.id,
      condition: record?.condition || null,
      occurrence: record?.occurrence || '',
      responseId: record?.id || null,
      responseAt: record?.createdAt?.toMillis?.() || null
    };
  });
  const snapshot = {
    date: day,
    responsibleUid: responsible.responsibleUid,
    responsibleName: responsible.responsibleName,
    responsibleEmail: responsible.responsibleEmail,
    position: responsible.position,
    sigla: responsible.sigla,
    entries
  };
  const revision = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return {profile, snapshot, revision, missing: entries.filter((item) => !item.condition).length};
}

export const checklistSignature = onCall({region: REGION, enforceAppCheck: false}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no SAHMT antes de continuar.');
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Confirme o e-mail da identidade Firebase antes de assinar.');
  }
  const day = String(request.data?.day || '');
  const mode = String(request.data?.mode || 'preview');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day !== saoPauloDay()) {
    throw new HttpsError('failed-precondition', 'Só é possível assinar o Checklist do dia atual em São Paulo.');
  }
  if (!['preview', 'sign'].includes(mode)) throw new HttpsError('invalid-argument', 'Solicitação inválida.');

  return db.runTransaction(async (transaction) => {
    const current = await readSnapshot(transaction, day, uid);
    const signatureId = `${day}_${current.revision}`;
    const signatureRef = db.doc(`checklistSignatures/${signatureId}`);
    const existing = await transaction.get(signatureRef);
    if (mode === 'preview') {
      return {day, revision: current.revision, missing: current.missing, total: current.snapshot.entries.length, responsible: {
        uid: current.snapshot.responsibleUid,
        name: current.snapshot.responsibleName,
        sigla: current.snapshot.sigla,
        position: current.snapshot.position
      }, signed: existing.exists, signedBy: existing.exists ? {name: existing.data().signerName, uid: existing.data().signerUid} : null,
      declaration: 'Confirmo que revisei as respostas e o responsável do Checklist deste dia.'};
    }
    if (request.data?.declaration !== true || request.data?.revision !== current.revision) {
      throw new HttpsError('failed-precondition', 'O relatório mudou desde a revisão. Atualize e confira novamente antes de assinar.');
    }
    const justification = String(request.data?.justification || '').trim().slice(0, 500);
    if ((current.missing > 0 || current.snapshot.responsibleUid !== uid) && justification.length < 8) {
      throw new HttpsError('invalid-argument', 'Informe a justificativa para Checklist incompleto ou assinatura por substituto.');
    }
    if (existing.exists) return {day, revision: current.revision, signed: true, alreadySigned: true};

    const pointsAwarded = current.missing === 0;
    const isSubstitute = current.snapshot.responsibleUid !== uid;
    const scoreEntries = pointsAwarded ? [
      {
        uid: current.snapshot.responsibleUid,
        ruleId: 'checklist-daily-responsible-v1',
        points: 1,
        suffix: 'responsible'
      },
      ...(isSubstitute ? [
        {uid, ruleId: 'checklist-daily-substitute-v1', points: 1, suffix: 'substitute'},
        {uid: current.snapshot.responsibleUid, ruleId: 'checklist-daily-substitution-adjustment-v1', points: -1, suffix: 'substitution-adjustment'}
      ] : [])
    ] : [];
    const scoreRefs = scoreEntries.map(({suffix}) => db.doc(`scores/checklist-${signatureId}-${suffix}`));
    const existingScores = await Promise.all(scoreRefs.map((reference) => transaction.get(reference)));
    if (existingScores.some((score) => score.exists)) {
      throw new HttpsError('failed-precondition', 'A pontuação desta assinatura está inconsistente; solicite reconciliação administrativa.');
    }

    transaction.create(signatureRef, {
      id: signatureId,
      date: day,
      checklistId: day,
      responsibleUid: current.snapshot.responsibleUid,
      responsibleName: current.snapshot.responsibleName,
      responsibleEmail: current.snapshot.responsibleEmail,
      signerUid: uid,
      signerName: current.profile.displayName || '',
      signerEmail: current.profile.email || '',
      declaration: true,
      revision: current.revision,
      snapshot: current.snapshot,
      missing: current.missing,
      justification,
      signedAt: FieldValue.serverTimestamp()
    });
    scoreEntries.forEach((entry, index) => transaction.create(scoreRefs[index], {
      id: scoreRefs[index].id,
      uid: entry.uid,
      sourceType: 'checklistSignature',
      sourceId: signatureId,
      ruleId: entry.ruleId,
      points: entry.points,
      createdByUid: uid,
      createdAt: FieldValue.serverTimestamp()
    }));
    return {
      day,
      revision: current.revision,
      signed: true,
      alreadySigned: false,
      pointsAwarded: pointsAwarded ? 1 : 0,
      responsibleAdjustment: pointsAwarded && isSubstitute ? -1 : 0,
      pointsPending: current.missing > 0
    };
  });
});

export const trainingStart = onCall({region: REGION, enforceAppCheck: false}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no SAHMT antes de iniciar o treinamento.');
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Confirme o e-mail da identidade Firebase antes de pontuar o treinamento.');
  }
  const trainingId = String(request.data?.trainingId || '').trim();
  if (!/^[^/]{1,128}$/.test(trainingId)) throw new HttpsError('invalid-argument', 'Treinamento inválido.');

  const key = createHash('sha256').update(`${uid}\u0000${trainingId}`).digest('hex');
  const receiptRef = db.doc(`trainingReceipts/start-${key}`);
  const scoreRef = db.doc(`scores/training-access-${key}`);
  const profileRef = db.doc(`users/${uid}`);
  const trainingRef = db.doc(`trainings/${trainingId}`);
  return db.runTransaction(async (transaction) => {
    const [profileDoc, trainingDoc, receiptDoc] = await Promise.all([
      transaction.get(profileRef), transaction.get(trainingRef), transaction.get(receiptRef)
    ]);
    if (!profileDoc.exists) throw new HttpsError('permission-denied', 'Perfil SAHMT não encontrado.');
    const profile = profileDoc.data();
    const mayReadTrainings = profile.role === 'administrador_app' || profile.permissions?.admin === true ||
      profile.permissions?.trainingsRead === true || profile.permissions?.trainingsManage === true;
    if (profile.uid !== uid || profile.active !== true || profile.access !== true || !mayReadTrainings) {
      throw new HttpsError('permission-denied', 'Seu perfil não tem acesso aos treinamentos.');
    }
    if (!trainingDoc.exists || trainingDoc.data().id !== trainingId || trainingDoc.data().active !== true) {
      throw new HttpsError('not-found', 'Este treinamento não está ativo.');
    }
    const training = trainingDoc.data();
    const accessPoints = Number(training.accessPoints);
    const completionPoints = Number(training.completionPoints);
    if (!Number.isFinite(accessPoints) || accessPoints < 0 || accessPoints > 1000 ||
        !Number.isFinite(completionPoints) || completionPoints < 0 || completionPoints > 1000) {
      throw new HttpsError('failed-precondition', 'A pontuação configurada deste treinamento está inválida.');
    }
    const existingScore = accessPoints > 0 ? await transaction.get(scoreRef) : null;
    if (receiptDoc.exists) {
      const receipt = receiptDoc.data();
      if (receipt.uid !== uid || receipt.trainingId !== trainingId || receipt.sourceType !== 'trainingStart') {
        throw new HttpsError('failed-precondition', 'O recibo de acesso ao treinamento está inconsistente.');
      }
      return {started: true, alreadyStarted: true, pointsAwarded: 0};
    }
    if (existingScore?.exists) {
      throw new HttpsError('failed-precondition', 'A pontuação deste início está inconsistente; solicite reconciliação administrativa.');
    }

    transaction.create(receiptRef, {
      id: receiptRef.id,
      uid,
      trainingId,
      trainingVersion: Number(training.version) || 1,
      completionPoints,
      sourceType: 'trainingStart',
      startedAt: FieldValue.serverTimestamp()
    });
    if (accessPoints > 0) transaction.create(scoreRef, {
      id: scoreRef.id,
      uid,
      sourceType: 'trainingStart',
      sourceId: receiptRef.id,
      ruleId: 'training-access-v1',
      points: accessPoints,
      createdByUid: uid,
      createdAt: FieldValue.serverTimestamp()
    });
    return {started: true, alreadyStarted: false, pointsAwarded: accessPoints};
  });
});

function trainingWatchedPercent(progress) {
  const duration = Number(progress?.duration);
  const ranges = progress?.watchedRanges;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400 || !Array.isArray(ranges) || ranges.length > 500) {
    throw new HttpsError('failed-precondition', 'O progresso salvo deste treinamento não pode ser validado.');
  }
  const ordered = ranges.map((range) => {
    const start = Number(range?.start);
    const end = Number(range?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > duration + 2) {
      throw new HttpsError('failed-precondition', 'Há intervalos de reprodução inválidos no progresso salvo.');
    }
    return [start, Math.min(end, duration)];
  }).sort((left, right) => left[0] - right[0]);
  const merged = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  const watchedSeconds = merged.reduce((total, [start, end]) => total + end - start, 0);
  return {duration, watchedSeconds, percent: Math.min(100, Math.round(watchedSeconds / duration * 1000) / 10)};
}

export const completeTraining = onCall({region: REGION, enforceAppCheck: false}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no SAHMT antes de concluir o treinamento.');
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Confirme o e-mail da identidade Firebase antes de concluir o treinamento.');
  }
  const trainingId = String(request.data?.trainingId || '').trim();
  if (!/^[^/]{1,128}$/.test(trainingId)) throw new HttpsError('invalid-argument', 'Treinamento inválido.');
  if (request.data?.ended !== true) throw new HttpsError('failed-precondition', 'O player ainda não confirmou o encerramento do vídeo.');

  const key = createHash('sha256').update(`${uid}\u0000${trainingId}`).digest('hex');
  const profileRef = db.doc(`users/${uid}`);
  const startReceiptRef = db.doc(`trainingReceipts/start-${key}`);
  const progressRef = db.doc(`trainingProgress/${uid}_${trainingId}`);
  const completionRef = db.doc(`trainingCompletions/complete-${key}`);
  const scoreRef = db.doc(`scores/training-completion-${key}`);
  return db.runTransaction(async (transaction) => {
    const [profileDoc, startReceiptDoc, progressDoc, completionDoc] = await Promise.all([
      transaction.get(profileRef), transaction.get(startReceiptRef), transaction.get(progressRef), transaction.get(completionRef)
    ]);
    if (!profileDoc.exists) throw new HttpsError('permission-denied', 'Perfil SAHMT não encontrado.');
    const profile = profileDoc.data();
    const mayReadTrainings = profile.role === 'administrador_app' || profile.permissions?.admin === true ||
      profile.permissions?.trainingsRead === true || profile.permissions?.trainingsManage === true;
    if (profile.uid !== uid || profile.active !== true || profile.access !== true || !mayReadTrainings) {
      throw new HttpsError('permission-denied', 'Seu perfil não tem acesso aos treinamentos.');
    }
    if (!startReceiptDoc.exists || !progressDoc.exists) {
      throw new HttpsError('failed-precondition', 'Inicie o treinamento e sincronize o progresso antes de concluir.');
    }
    const startReceipt = startReceiptDoc.data();
    if (startReceipt.uid !== uid || startReceipt.trainingId !== trainingId || startReceipt.sourceType !== 'trainingStart') {
      throw new HttpsError('failed-precondition', 'O recibo de início do treinamento está inconsistente.');
    }
    if (completionDoc.exists) {
      const completion = completionDoc.data();
      if (completion.uid !== uid || completion.trainingId !== trainingId || completion.sourceType !== 'trainingCompletion') {
        throw new HttpsError('failed-precondition', 'O recibo de conclusão do treinamento está inconsistente.');
      }
      const scoreDoc = await transaction.get(scoreRef);
      if (completion.points > 0 && (!scoreDoc.exists || scoreDoc.data().uid !== uid || scoreDoc.data().sourceId !== completionRef.id || scoreDoc.data().points !== completion.points)) {
        throw new HttpsError('failed-precondition', 'A pontuação da conclusão está inconsistente; solicite reconciliação administrativa.');
      }
      if (completion.points === 0 && scoreDoc.exists) {
        throw new HttpsError('failed-precondition', 'Há pontuação inesperada para uma conclusão sem pontos.');
      }
      return {completed: true, alreadyCompleted: true, pointsAwarded: 0, watchedPercent: completion.watchedPercent};
    }
    const progress = progressDoc.data();
    if (progress.uid !== uid || progress.trainingId !== trainingId || !['STARTED', 'IN_PROGRESS'].includes(progress.status)) {
      throw new HttpsError('failed-precondition', 'O progresso do treinamento não está em um estado concluível.');
    }
    const watched = trainingWatchedPercent(progress);
    if (watched.watchedSeconds / watched.duration < 0.95) {
      throw new HttpsError('failed-precondition', `O vídeo precisa ter pelo menos 95% de reprodução registrada; o progresso salvo está em ${watched.percent}%.`);
    }
    const points = Number(startReceipt.completionPoints);
    if (!Number.isFinite(points) || points < 0 || points > 1000) {
      throw new HttpsError('failed-precondition', 'A pontuação de conclusão não está registrada no recibo de início.');
    }
    const existingScore = await transaction.get(scoreRef);
    if (existingScore.exists) throw new HttpsError('failed-precondition', 'A pontuação de conclusão está inconsistente; solicite reconciliação administrativa.');

    transaction.create(completionRef, {
      id: completionRef.id,
      uid,
      trainingId,
      trainingVersion: startReceipt.trainingVersion,
      sourceType: 'trainingCompletion',
      duration: watched.duration,
      watchedSeconds: watched.watchedSeconds,
      watchedPercent: watched.percent,
      points,
      completedAt: FieldValue.serverTimestamp()
    });
    transaction.update(progressRef, {status: 'COMPLETED', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()});
    if (points > 0) transaction.create(scoreRef, {
      id: scoreRef.id,
      uid,
      sourceType: 'trainingCompletion',
      sourceId: completionRef.id,
      ruleId: 'training-completion-v1',
      trainingVersion: startReceipt.trainingVersion,
      points,
      createdByUid: uid,
      createdAt: FieldValue.serverTimestamp()
    });
    return {completed: true, alreadyCompleted: false, pointsAwarded: points, watchedPercent: watched.percent};
  });
});

export const completeManagementActivity = onCall({region: REGION, enforceAppCheck: false}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no SAHMT antes de concluir a atividade.');
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Confirme o e-mail da identidade Firebase antes de concluir.');
  }
  const activityId = String(request.data?.activityId || '').trim();
  if (!/^[^/]{1,128}$/.test(activityId)) throw new HttpsError('invalid-argument', 'Atividade inválida.');
  const activityRef = db.doc(`activities/${activityId}`);
  const profileRef = db.doc(`users/${uid}`);
  const interactionId = `completion-${createHash('sha256').update(`${activityId}\u0000${uid}`).digest('hex')}`;
  const interactionRef = db.doc(`activityInteractions/${interactionId}`);
  const scoreId = `activity-${createHash('sha256').update(`${activityId}\u0000${uid}`).digest('hex')}`;
  const scoreRef = db.doc(`scores/${scoreId}`);
  return db.runTransaction(async (transaction) => {
    const [profileDoc, activityDoc] = await Promise.all([transaction.get(profileRef), transaction.get(activityRef)]);
    if (!profileDoc.exists) throw new HttpsError('permission-denied', 'Perfil SAHMT não encontrado.');
    const profile = profileDoc.data();
    const mayUseManagement = profile.role === 'administrador_app' || profile.permissions?.admin === true ||
      profile.permissions?.managementRead === true || profile.permissions?.managementActivityWrite === true ||
      profile.permissions?.managementManage === true;
    if (profile.uid !== uid || profile.active !== true || profile.access !== true || !mayUseManagement) {
      throw new HttpsError('permission-denied', 'Seu perfil não tem acesso às atividades de Gestão.');
    }
    if (!activityDoc.exists) throw new HttpsError('not-found', 'A atividade não está disponível.');
    const activity = activityDoc.data();
    if (activity.active !== true || !Array.isArray(activity.responsibleUids) || !activity.responsibleUids.includes(uid)) {
      throw new HttpsError('permission-denied', 'Esta atividade não está atribuída a você.');
    }
    const [interactionDoc, existingScoreDoc] = await Promise.all([
      transaction.get(interactionRef), transaction.get(scoreRef)
    ]);
    if (activity.status === 'COMPLETED') {
      if (activity.pointsEnabled === true && (!interactionDoc.exists || !existingScoreDoc.exists)) {
        throw new HttpsError('failed-precondition', 'A conclusão pontuada está inconsistente; solicite reconciliação administrativa.');
      }
      return {completed: true, alreadyCompleted: true, pointsAwarded: 0};
    }
    if (activity.status !== 'IN_PROGRESS') throw new HttpsError('failed-precondition', 'Inicie a atividade antes de concluí-la.');
    if (activity.evidenceRequired === true) {
      throw new HttpsError('failed-precondition', 'A evidência obrigatória ainda não possui um validador confiável.');
    }
    let points = 0;
    let ruleId = '';
    let ruleVersion = 0;
    if (activity.pointsEnabled === true) {
      if (!Number.isInteger(activity.points) || activity.points < 1 || activity.points > 1000 ||
          activity.scoringRuleId !== 'management-task-completion-v1' || !Number.isInteger(activity.scoringRuleVersion) || activity.scoringRuleVersion < 1) {
        throw new HttpsError('failed-precondition', 'A configuração de pontuação desta atividade é inválida.');
      }
      if (existingScoreDoc.exists || interactionDoc.exists) {
        throw new HttpsError('failed-precondition', 'Há um lançamento de pontuação anterior sem conclusão correspondente.');
      }
      points = activity.points;
      ruleId = activity.scoringRuleId;
      ruleVersion = activity.scoringRuleVersion;
    } else if (existingScoreDoc.exists || interactionDoc.exists) {
      throw new HttpsError('failed-precondition', 'Há um recibo anterior sem conclusão correspondente.');
    }

    transaction.update(activityRef, {
      status: 'COMPLETED',
      completedAt: FieldValue.serverTimestamp(),
      updatedByUid: uid,
      updatedAt: FieldValue.serverTimestamp(),
      version: (Number.isInteger(activity.version) ? activity.version : 0) + 1
    });
    transaction.create(interactionRef, {
      id: interactionId,
      activityId,
      uid,
      type: 'COMPLETION',
      status: 'CONFIRMED',
      content: 'Atividade concluída pelo responsável.',
      evidence: null,
      pointsGenerated: points,
      createdAt: FieldValue.serverTimestamp()
    });
    if (points > 0) transaction.create(scoreRef, {
      id: scoreId,
      uid,
      sourceType: 'MANAGEMENT_TASK_COMPLETION',
      sourceId: interactionId,
      ruleId,
      ruleVersion,
      points,
      createdByUid: uid,
      createdAt: FieldValue.serverTimestamp()
    });
    return {completed: true, alreadyCompleted: false, pointsAwarded: points};
  });
});

export const cancelManagementActivity = onCall({region: REGION, enforceAppCheck: false}, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no SAHMT antes de cancelar a atividade.');
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Confirme o e-mail da identidade Firebase antes de cancelar.');
  }
  const activityId = String(request.data?.activityId || '').trim();
  if (!/^[^/]{1,128}$/.test(activityId)) throw new HttpsError('invalid-argument', 'Atividade inválida.');
  const activityRef = db.doc(`activities/${activityId}`);
  const profileRef = db.doc(`users/${uid}`);
  const interactionId = `cancellation-${createHash('sha256').update(`${activityId}\u0000${uid}`).digest('hex')}`;
  const interactionRef = db.doc(`activityInteractions/${interactionId}`);
  return db.runTransaction(async (transaction) => {
    const [profileDoc, activityDoc] = await Promise.all([transaction.get(profileRef), transaction.get(activityRef)]);
    if (!profileDoc.exists) throw new HttpsError('permission-denied', 'Perfil SAHMT não encontrado.');
    const profile = profileDoc.data();
    const mayUseManagement = profile.role === 'administrador_app' || profile.permissions?.admin === true ||
      profile.permissions?.managementActivityWrite === true || profile.permissions?.managementManage === true;
    if (profile.uid !== uid || profile.active !== true || profile.access !== true || !mayUseManagement) {
      throw new HttpsError('permission-denied', 'Seu perfil não pode cancelar atividades de Gestão.');
    }
    if (!activityDoc.exists) throw new HttpsError('not-found', 'A atividade não está disponível.');
    const activity = activityDoc.data();
    if (activity.active !== true || (activity.createdByUid !== uid && profile.permissions?.managementManage !== true && profile.role !== 'administrador_app' && profile.permissions?.admin !== true)) {
      throw new HttpsError('permission-denied', 'Somente quem criou a atividade ou a gestão pode cancelá-la.');
    }
    const interactionDoc = await transaction.get(interactionRef);
    if (activity.status === 'CANCELLED') {
      if (!interactionDoc.exists) throw new HttpsError('failed-precondition', 'A atividade cancelada não tem recibo de auditoria.');
      return {cancelled: true, alreadyCancelled: true};
    }
    if (!['OPEN', 'IN_PROGRESS'].includes(activity.status)) {
      throw new HttpsError('failed-precondition', 'Somente atividades abertas ou em andamento podem ser canceladas.');
    }
    transaction.update(activityRef, {
      status: 'CANCELLED',
      completedAt: null,
      updatedByUid: uid,
      updatedAt: FieldValue.serverTimestamp(),
      version: (Number.isInteger(activity.version) ? activity.version : 0) + 1
    });
    transaction.create(interactionRef, {
      id: interactionId,
      activityId,
      uid,
      type: 'CANCELLATION',
      status: 'CONFIRMED',
      content: 'Atividade cancelada pela pessoa criadora ou pela Gestão.',
      evidence: null,
      pointsGenerated: 0,
      createdAt: FieldValue.serverTimestamp()
    });
    return {cancelled: true, alreadyCancelled: false};
  });
});

function createReportSyncTrigger(collectionName) {
  return onDocumentWritten({document: `${collectionName}/{resourceId}`, region: REGION, retry: true}, async (event) => {
    const change = event.data;
    if (!change?.before || !change?.after || (!change.before.exists && !change.after.exists)) return;

    const source = change.after.exists ? change.after : change.before;
    const storedVersion = source.get('version');
    const version = Number.isInteger(storedVersion) && storedVersion > 0 ? storedVersion : 1;
    const job = buildReportSyncJob({
      collectionName,
      resourceId: event.params.resourceId,
      eventId: event.id,
      beforeExists: change.before.exists,
      afterExists: change.after.exists,
      version,
      now: new Date()
    });
    const jobRef = db.collection('syncQueue').doc(job.id);

    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(jobRef);
      if (!existing.exists) transaction.create(jobRef, job);
    });
  });
}

export const queueEventsReportSync = createReportSyncTrigger('events');
export const queueChecklistsReportSync = createReportSyncTrigger('checklists');
export const queueTrainingsReportSync = createReportSyncTrigger('trainings');
export const queueTrainingReceiptsReportSync = createReportSyncTrigger('trainingReceipts');
export const queueTrainingCompletionsReportSync = createReportSyncTrigger('trainingCompletions');
export const queueActivitiesReportSync = createReportSyncTrigger('activities');
export const queueActivityInteractionsReportSync = createReportSyncTrigger('activityInteractions');
export const queueIndicatorsReportSync = createReportSyncTrigger('indicators');
export const queueIndicatorMeasurementsReportSync = createReportSyncTrigger('indicatorMeasurements');
export const queueActionPlansReportSync = createReportSyncTrigger('actionPlans');
export const queueActionPlanItemsReportSync = createReportSyncTrigger('actionPlanItems');
export const queueScoresReportSync = createReportSyncTrigger('scores');
export const queueAuditLogsReportSync = createReportSyncTrigger('auditLogs');
