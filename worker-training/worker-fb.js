import {createTrainingWorker} from './worker.js';

const training = createTrainingWorker();

export default {
  fetch(request, env, context) {
    if (new URL(request.url).pathname !== '/v1/training') {
      return Response.json({code:'TRAINING_ROUTE_UNKNOWN'},{status:404,headers:{'Cache-Control':'no-store'}});
    }
    return training.fetch(request, env, context);
  }
};
