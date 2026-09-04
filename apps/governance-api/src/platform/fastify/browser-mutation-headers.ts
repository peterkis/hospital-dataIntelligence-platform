import { Type } from '@fastify/type-provider-typebox';

// Header validation complements the session-bound check in resolvePrincipal().
export const BrowserMutationHeadersSchema = Type.Object({
  'x-csrf-token': Type.String({ minLength: 32 }),
});
