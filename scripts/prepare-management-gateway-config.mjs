import {createDisabledManagementGatewayConfig} from './lib/management-gateway-config-preparation.js';

const actorEmail = process.env.SAHMT_GATEWAY_ACTOR_EMAIL;
if (typeof actorEmail !== 'string' || !actorEmail.trim()) {
  process.stderr.write('GATEWAY_ACTOR_EMAIL_REQUIRED\n');
  process.exitCode = 2;
} else {
  try {
    const generated = createDisabledManagementGatewayConfig({actorEmail});
    // This output contains only the non-secret config JSON and its pin. HMAC
    // secret generation and transport are intentionally outside this command.
    process.stdout.write(JSON.stringify({
      property: 'MANAGEMENT_GATEWAY_CONFIG_JSON',
      value: generated.canonicalJson,
      sha256Property: 'MANAGEMENT_GATEWAY_CONFIG_SHA256',
      sha256: generated.sha256
    }) + '\n');
  } catch (error) {
    process.stderr.write((typeof error?.message === 'string' && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message : 'GATEWAY_CONFIG_PREPARATION_FAILED') + '\n');
    process.exitCode = 2;
  }
}
