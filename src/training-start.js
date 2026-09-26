import {completeTrainingInFirestore, startTrainingInFirestore} from './data.js';

export function startTraining(trainingId, uid) {
  return startTrainingInFirestore(uid, trainingId);
}

export function completeTraining(trainingId, {ended = false, uid} = {}) {
  return completeTrainingInFirestore(uid, trainingId, {ended});
}
