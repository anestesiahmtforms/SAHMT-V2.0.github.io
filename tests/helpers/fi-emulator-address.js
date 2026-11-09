// Explicit override allows isolated worktrees to avoid another test run's port.
// The network target remains pinned to loopback and an exact declared port.
export const fiEmulatorPort=Number(process.env.SAHMT_FI_TEST_PORT||18516);
export function assertFiEmulator(){if(!Number.isSafeInteger(fiEmulatorPort)||fiEmulatorPort<1024||fiEmulatorPort>65535||process.env.FIRESTORE_EMULATOR_HOST!==`127.0.0.1:${fiEmulatorPort}`)throw Error('FI_FJ_LOCAL_EMULATOR_REQUIRED');}
