import {describeManagementRetirementReadPlan} from './lib/management-retirement-dependency-scan.js';

// This command is deliberately plan-only: it has no Firebase CLI auth import,
// OAuth token acquisition, fetch call, filesystem write, or data access.
if (process.argv.length !== 2) {
  console.error(JSON.stringify({code: 'RETIREMENT_PLAN_TAKES_NO_ARGUMENTS'}));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(describeManagementRetirementReadPlan(), null, 2));
}
