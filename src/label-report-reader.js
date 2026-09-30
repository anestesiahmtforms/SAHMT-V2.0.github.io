import {collection, getDocs, limit, orderBy, query, startAfter, where} from 'firebase/firestore/lite';
import {db} from './firebase-lite.js';

function dateSortValue(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return value ? new Date(value).getTime() : Number.MAX_SAFE_INTEGER;
}

export async function listLabelRecords({from, to, uid, sigla = '', canManage = false, pageSize = 50, cursor = null} = {}) {
  if (!from || !to || from > to) throw new Error('Informe um período válido para consultar as etiquetas.');
  if (!uid) throw new Error('A sessão expirou. Entre novamente para consultar etiquetas.');
  const currentLimit = Math.min(100, Math.max(1, pageSize));
  const dateFilters = from === to ? [where('date', '==', from)] : [where('date', '>=', from), where('date', '<=', to)];
  const base = [where('active', '==', true), ...dateFilters];
  const cursorMode = canManage ? 'admin' : 'staff';
  if (cursor && cursor.mode !== cursorMode) cursor = null;
  const list = async (extra = [], after = null) => getDocs(query(
    collection(db, 'labels'), ...base, ...extra, orderBy('date', 'desc'), ...(after ? [startAfter(after)] : []), limit(currentLimit)
  ));
  let snapshots = [];
  let nextCursor = null;
  if (canManage) {
    const done = cursor?.adminDone === true;
    const snapshot = done ? null : await list([], cursor?.admin || null);
    if (snapshot) snapshots.push(snapshot);
    nextCursor = snapshot && snapshot.docs.length === currentLimit
      ? {mode: 'admin', admin: snapshot.docs[snapshot.docs.length - 1], adminDone: false}
      : null;
  } else {
    const ownDone = cursor?.ownDone === true;
    const staffDone = !sigla || cursor?.staffDone === true;
    const [own, staff] = await Promise.all([
      ownDone ? null : list([where('createdByUid', '==', uid)], cursor?.own || null),
      staffDone ? null : list([where('staffSiglas', 'array-contains', sigla)], cursor?.staff || null)
    ]);
    if (own) snapshots.push(own);
    if (staff) snapshots.push(staff);
    const nextOwnDone = ownDone || !own || own.docs.length < currentLimit;
    const nextStaffDone = staffDone || !staff || staff.docs.length < currentLimit;
    nextCursor = nextOwnDone && nextStaffDone ? null : {
      mode: 'staff',
      own: own?.docs.length ? own.docs[own.docs.length - 1] : cursor?.own || null,
      ownDone: nextOwnDone,
      staff: staff?.docs.length ? staff.docs[staff.docs.length - 1] : cursor?.staff || null,
      staffDone: nextStaffDone
    };
  }
  const records = new Map();
  for (const snapshot of snapshots) {
    for (const item of snapshot.docs) records.set(item.id, {id: item.id, ...item.data()});
  }
  return {
    records: [...records.values()].sort((left, right) => String(right.date).localeCompare(String(left.date)) || dateSortValue(right.createdAt) - dateSortValue(left.createdAt)),
    nextCursor
  };
}

