import sessions from '../worker-operational-domain/worker.js';
import {relayFgScience} from './science-relay.js';

export default {
  fetch(request,env){
    if(new URL(request.url).pathname==='/v1/science/settle')return relayFgScience(request,env);
    return sessions.fetch(request,env);
  }
};
