// Deployment staging supplies this module from a protected live readback.
// Never substitute the checkout's central Worker for that production snapshot.
import central from './central-base.js';
export * from './central-base.js';
import {withFcCompatibility} from './fc-compat-forward.js';
export default withFcCompatibility(central);
