export async function obtainClientCredentialsAccessToken(options: {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
}): Promise<string> {
  const response = await fetch(options.tokenEndpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`SIM_CONSUMER_TOKEN_HTTP_${response.status}`);
  const tokenSet = (await response.json()) as { readonly access_token?: unknown };
  if (typeof tokenSet.access_token !== 'string') {
    throw new Error('SIM_CONSUMER_ACCESS_TOKEN_REQUIRED');
  }
  return tokenSet.access_token;
}
