export const PROTOTYPE_DATABASE_POOL_CLOSED_EVENT = 'PROTOTYPE_DATABASE_POOL_CLOSED' as const;

interface Closable {
  close(): Promise<void>;
}

export async function closePrototypeResources(input: {
  readonly application: Closable | undefined;
  readonly database: Closable;
  readonly onResourcesClosed?: () => void | Promise<void>;
}): Promise<void> {
  const errors: unknown[] = [];
  if (input.application) {
    try {
      await input.application.close();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await input.database.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length !== 0) {
    throw new AggregateError(errors, 'PROTOTYPE_RESOURCE_CLOSE_FAILED');
  }
  await input.onResourcesClosed?.();
}
