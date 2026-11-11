import {assertFolderReadable} from '../server/folder-read-policy.js';
import {assertFirestoreFoldersReadable} from '../server/firestore-folder-policy.js';

export async function assertFeFolderReadable(folder, getAccessToken, transaction, prefix = 'SURVEY') {
  try {
    if (transaction) {
      const policy = await transaction.get('runtimePolicy', 'folders');
      if (policy !== null) assertFolderReadable(policy, folder);
      return;
    }
    await assertFirestoreFoldersReadable({
      root: 'https://firestore.googleapis.com/v1/projects/outros-48120/databases/(default)/documents',
      token: await getAccessToken(),
      folders: [folder]
    });
  } catch (error) {
    const disabled = error.code === 'FOLDER_DISABLED';
    const code = prefix + (disabled ? '_FOLDER_DISABLED' : '_FOLDER_POLICY_UNAVAILABLE');
    throw Object.assign(Error(code), {code, status: disabled ? 403 : 503});
  }
}
