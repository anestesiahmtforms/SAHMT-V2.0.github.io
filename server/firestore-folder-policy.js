import {assertFolderReadable} from './folder-read-policy.js';

export async function assertFirestoreFoldersReadable({root, token, fetchImpl = fetch, folders, includeDescendants = []}) {
  const response = await fetchImpl(root + '/runtimePolicy/folders', {
    method: 'GET',
    headers: {Authorization: 'Bearer ' + token},
    cache: 'no-store',
    redirect: 'manual',
    signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error('FOLDER_POLICY_UNAVAILABLE');
  }

  const {fields} = await response.json();
  const disabled = fields?.disabled?.arrayValue;
  if (!disabled || typeof disabled !== 'object' || Array.isArray(disabled)) throw Error('FOLDER_POLICY_INVALID');
  const entries = disabled.values === undefined ? [] : disabled.values;
  if (!Array.isArray(entries)) throw Error('FOLDER_POLICY_INVALID');
  const policy = {
    schemaVersion: Number(fields.schemaVersion?.integerValue),
    revision: Number(fields.revision?.integerValue),
    disabled: entries.map(value => value?.stringValue)
  };
  for (const folder of folders) assertFolderReadable(policy, folder);
  for (const id of policy.disabled) {
    if (includeDescendants.some(folder => id.startsWith(folder + '/'))) assertFolderReadable(policy, id);
  }
}
