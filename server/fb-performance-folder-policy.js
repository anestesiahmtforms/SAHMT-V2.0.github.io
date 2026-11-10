import {assertFolderReadable} from './folder-read-policy.js';
import {parseTrainingFolderAccess} from '../src/html-training-folders.js';

export async function assertFbPerformanceReadable(store) {
  const policy = await store.get('runtimePolicy', 'folders');
  if (policy !== null) {
    assertFolderReadable(policy, 'desempenho/fb');
    assertFolderReadable(policy, 'gestao');
    // The aggregate does not separate awards by independently managed folder.
    if (policy.disabled.some(id => id.startsWith('gestao/'))) {
      throw Object.assign(Error('FOLDER_DISABLED'), {code: 'FOLDER_DISABLED', status: 403});
    }
  }
  await assertFbTrainingAggregateReadable(store);
}

export async function assertFbTrainingAggregateReadable(store) {
  const trainingPolicy = await store.get('htmlTrainingSettings', 'folders');
  if (trainingPolicy === null) return;
  const access = parseTrainingFolderAccess(trainingPolicy);
  if (!access) throw Object.assign(Error('FOLDER_POLICY_INVALID'), {code: 'FOLDER_POLICY_INVALID', status: 503});
  if (access.disabled.length) throw Object.assign(Error('FOLDER_DISABLED'), {code: 'FOLDER_DISABLED', status: 403});
}
