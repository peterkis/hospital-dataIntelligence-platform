import type { TSchema } from "typebox";
type SchemaNode = TSchema & {
  properties?: Record<string, TSchema>;
  required?: string[];
  items?: TSchema;
  minItems?: number;
  anyOf?: TSchema[];
};
/** Closed fields and types survive; only presence is relaxed for partial editing. */
export function partialEditingSchema(schema: TSchema): TSchema {
  const result = structuredClone(schema) as SchemaNode;
  if (result.properties) {
    delete result.required;
    result.properties = Object.fromEntries(
      Object.entries(result.properties).map(([key, value]) => [
        key,
        partialEditingSchema(value),
      ]),
    );
  }
  if (result.items) {
    result.items = partialEditingSchema(result.items);
    delete result.minItems;
  }
  if (result.anyOf) result.anyOf = result.anyOf.map(partialEditingSchema);
  return result;
}
