import { access } from 'node:fs/promises';

/** Resolve repository-local TypeScript sources whose authored imports use emitted `.js` names. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== 'ERR_MODULE_NOT_FOUND' ||
      (!specifier.startsWith('./') && !specifier.startsWith('../')) ||
      !specifier.endsWith('.js')
    ) throw error;
    const candidate = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    try {
      await access(candidate);
    } catch {
      throw error;
    }
    return nextResolve(candidate.href, context);
  }
}
