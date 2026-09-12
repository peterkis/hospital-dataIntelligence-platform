// Require an explicit database and reject libpq URL query overrides.
export function localDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('LOCAL_DATABASE_REQUIRED'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.search || url.hash ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '55434' ||
      !/^\/[a-z_][a-z0-9_]*$/u.test(url.pathname) || !url.username) {
    throw new Error('LOCAL_DATABASE_REQUIRED');
  }
  return url;
}
