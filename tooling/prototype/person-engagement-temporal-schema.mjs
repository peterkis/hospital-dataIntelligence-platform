// Narrow normalization for four existing probe-restored PL/pgSQL definitions.
// Every other function remains byte-compared. Quoted values/identifiers stay exact.
const FORMATTING_VARIANTS = new Set([
  'department_master.protect_immutable_version',
  'department_master.protect_stable_identity',
  'department_master.touch_updated_at',
  'person_master.guard_engagement_classification',
]);
export function normalizeSchemaManifest(manifest) {
  return { ...manifest, functions: manifest.functions.map(row => {
    if (!FORMATTING_VARIANTS.has(`${row.nspname}.${row.proname}`) || row.arguments !== '') return row;
    return { ...row, definition: functionTokens(row.definition) };
  }) };
}
export function functionTokens(definition) {
  if (/\b[Ee]'|\b[Uu]&|\/\*|--|\$(?!function\$)[A-Za-z_]*\$/u.test(definition)) {
    throw new Error('SCHEMA_NORMALIZATION_UNSUPPORTED_SYNTAX');
  }
  const tokens = definition.match(/\s+|'(?:[^']|'')*'|"(?:[^"]|"")*"|\$function\$|[A-Za-z_][A-Za-z_0-9]*|\d+(?:\.\d+)?|>=|<=|<>|:=|[^\s]/gu) ?? [];
  return tokens.filter(token => !/^\s+$/u.test(token)).map(token =>
    /^[A-Za-z_][A-Za-z_0-9]*$/u.test(token) ? token.toLowerCase() : token);
}
