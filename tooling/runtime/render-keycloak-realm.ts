import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const outputPath = resolve(process.argv[2] ?? '.runtime/keycloak/phase01-realm.json');
const ownerPassword = requireEnvironment('HDI_OWNER_PASSWORD');
const browserClientSecret = requireEnvironment('HDI_BROWSER_CLIENT_SECRET');
const consumerASecret = requireEnvironment('HDI_SIM_CONSUMER_A_CLIENT_SECRET');
const consumerBSecret = requireEnvironment('HDI_SIM_CONSUMER_B_CLIENT_SECRET');

const audienceMapper = (id: string) => ({
  id,
  name: 'hdi-governance-api-audience',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  consentRequired: false,
  config: {
    'included.client.audience': 'hdi-governance-api',
    'access.token.claim': 'true',
    'id.token.claim': 'false',
    'introspection.token.claim': 'true',
  },
});

const realm = {
  id: 'hdi-phase01',
  realm: 'hdi-phase01',
  displayName: 'HDI Phase 01 POC',
  enabled: true,
  sslRequired: 'none',
  registrationAllowed: false,
  resetPasswordAllowed: false,
  loginWithEmailAllowed: false,
  duplicateEmailsAllowed: false,
  bruteForceProtected: true,
  clients: [
    {
      id: '20000000-0000-7000-8000-000000000001',
      clientId: 'hdi-governance-browser',
      name: 'HDI governance browser server client',
      enabled: true,
      protocol: 'openid-connect',
      clientAuthenticatorType: 'client-secret',
      secret: browserClientSecret,
      publicClient: false,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      redirectUris: ['http://127.0.0.1:3000/auth/callback'],
      webOrigins: ['http://127.0.0.1:3000'],
      attributes: { 'pkce.code.challenge.method': 'S256' },
    },
    {
      id: '20000000-0000-7000-8000-000000000002',
      clientId: 'hdi-governance-api',
      name: 'HDI governance API audience',
      enabled: true,
      protocol: 'openid-connect',
      bearerOnly: true,
      publicClient: false,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
    },
    {
      id: '20000000-0000-7000-8000-000000000003',
      clientId: 'hdi-sim-consumer-a',
      name: 'HDI simulated consumer A',
      enabled: true,
      protocol: 'openid-connect',
      clientAuthenticatorType: 'client-secret',
      secret: consumerASecret,
      publicClient: false,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: true,
      protocolMappers: [audienceMapper('30000000-0000-7000-8000-000000000001')],
    },
    {
      id: '20000000-0000-7000-8000-000000000004',
      clientId: 'hdi-sim-consumer-b',
      name: 'HDI simulated consumer B',
      enabled: true,
      protocol: 'openid-connect',
      clientAuthenticatorType: 'client-secret',
      secret: consumerBSecret,
      publicClient: false,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: true,
      protocolMappers: [audienceMapper('30000000-0000-7000-8000-000000000002')],
    },
  ],
  users: [
    {
      id: '10000000-0000-7000-8000-000000000001',
      username: 'phase01-owner',
      firstName: 'Phase 01',
      lastName: 'Owner',
      email: 'phase01-owner@poc.invalid',
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      credentials: [{ type: 'password', value: ownerPassword, temporary: false }],
    },
    {
      id: '10000000-0000-7000-8000-000000000002',
      username: 'phase01-reviewer',
      firstName: 'Phase 01',
      lastName: 'Reviewer',
      email: 'phase01-reviewer@poc.invalid',
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      credentials: [{ type: 'password', value: ownerPassword, temporary: false }],
    },
    {
      id: '10000000-0000-7000-8000-000000000003',
      username: 'phase01-final-owner',
      firstName: 'Phase 01',
      lastName: 'Final Owner',
      email: 'phase01-final-owner@poc.invalid',
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      credentials: [{ type: 'password', value: ownerPassword, temporary: false }],
    },
    {
      id: '10000000-0000-7000-8000-000000000004',
      username: 'phase01-campus-steward',
      firstName: 'Phase 01',
      lastName: 'Campus Steward',
      email: 'phase01-campus-steward@poc.invalid',
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      credentials: [{ type: 'password', value: ownerPassword, temporary: false }],
    },
    {
      id: '10000000-0000-7000-8000-000000000005',
      username: 'phase01-owner-alias',
      firstName: 'Phase 01',
      lastName: 'Owner Alias',
      email: 'phase01-owner-alias@poc.invalid',
      enabled: true,
      emailVerified: true,
      requiredActions: [],
      credentials: [{ type: 'password', value: ownerPassword, temporary: false }],
    },
  ],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(realm, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${outputPath}\n`);

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
