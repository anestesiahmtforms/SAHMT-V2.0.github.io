export const CHECKLIST_READ_PAGE_SIZE = 100;

export function assertChecklistReadCurrent(isCurrent) {
  if (!isCurrent()) throw Object.assign(new Error('Consulta do Checklist cancelada.'), {code: 'checklist-read-cancelled'});
}

/** Read to exhaustion; callers must never use an incomplete page as a full result. */
export async function readChecklistPages(collectionName, filters, visit, sdk, db, isCurrent) {
  let cursor = null;
  while (true) {
    assertChecklistReadCurrent(isCurrent);
    const result = await sdk.getDocs(sdk.query(sdk.collection(db, collectionName), ...filters,
      sdk.limit(CHECKLIST_READ_PAGE_SIZE), ...(cursor ? [sdk.startAfter(cursor)] : [])));
    assertChecklistReadCurrent(isCurrent);
    for (const document of result.docs) visit({...document.data(), id: document.id});
    if (result.docs.length < CHECKLIST_READ_PAGE_SIZE) return;
    const next = result.docs[result.docs.length - 1];
    if (next.id === cursor?.id) throw Object.assign(new Error('A consulta não avançou.'), {code: 'checklist-read-incomplete'});
    cursor = next;
  }
}
