import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const REPOSITORY_NODE_LOADER_PATH =
  './tooling/verification/node-ts-loader.mjs' as const;

export const REPOSITORY_TYPESCRIPT_ENTRY_PATHS = Object.freeze([
  'tests/e2e/run-playwright.ts',
  'tooling/verification/src/produce-abg-gate.ts',
  'tooling/verification/src/run-formal-abg.ts',
  'tooling/verification/src/run-shared-abg-verification.ts',
  'tooling/verification/src/verify-phase-01-live.ts',
] as const);

export type RepositoryTypeScriptEntryPath =
  (typeof REPOSITORY_TYPESCRIPT_ENTRY_PATHS)[number];

export interface RepositoryCommandSpec {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory?: string;
  readonly environment?: Readonly<Record<string, string>>;
}

export async function repositoryTypeScriptCommand(
  repositoryRoot: string,
  scriptPath: string,
  args: readonly string[] = [],
): Promise<RepositoryCommandSpec> {
  await assertRepositoryLoaderPath(repositoryRoot, REPOSITORY_NODE_LOADER_PATH);
  await assertRegisteredTypeScriptEntry(repositoryRoot, scriptPath);
  return Object.freeze({
    executable: 'node',
    args: Object.freeze([
      '--loader',
      REPOSITORY_NODE_LOADER_PATH,
      scriptPath,
      ...args,
    ]),
    workingDirectory: '.',
  });
}

export async function assertRepositoryTypeScriptCommand(
  repositoryRoot: string,
  command: RepositoryCommandSpec,
): Promise<void> {
  if (command.executable !== 'node' || command.args[0] !== '--loader') {
    throw new Error('REPOSITORY_TYPESCRIPT_ENTRY_WITHOUT_EXPLICIT_LOADER');
  }
  const loaderPath = command.args[1];
  if (loaderPath !== REPOSITORY_NODE_LOADER_PATH) {
    throw new Error('REPOSITORY_NODE_LOADER_PATH_INVALID');
  }
  if (command.workingDirectory !== '.') {
    throw new Error('REPOSITORY_TYPESCRIPT_WORKING_DIRECTORY_INVALID');
  }
  const scriptPath = command.args[2];
  if (scriptPath === undefined) {
    throw new Error('REPOSITORY_TYPESCRIPT_ENTRY_UNREGISTERED');
  }
  await assertRepositoryLoaderPath(repositoryRoot, loaderPath);
  await assertRegisteredTypeScriptEntry(repositoryRoot, scriptPath);
}

export function commandContainsRepositoryLoader(command: RepositoryCommandSpec): boolean {
  return command.args.some((argument) =>
    argument === '--loader' ||
    argument === REPOSITORY_NODE_LOADER_PATH ||
    argument.endsWith('/node-ts-loader.mjs') ||
    argument.endsWith('\\node-ts-loader.mjs')
  );
}

export function assertCommandEnvironmentDoesNotDeclareNodeOptions(
  environment: Readonly<Record<string, string>> | undefined,
  errorCode: string,
): void {
  if (environment !== undefined && hasNodeOptionsKey(environment)) {
    throw new Error(errorCode);
  }
}

export function assertCommandEnvironmentDoesNotDeclareDatabaseUrl(
  environment: Readonly<Record<string, string>> | undefined,
  errorCode: string,
): void {
  if (environment !== undefined && hasEnvironmentKey(environment, 'DATABASE_URL')) {
    throw new Error(errorCode);
  }
}

export function createDeterministicChildEnvironment(input: {
  readonly inheritedEnvironment: Readonly<NodeJS.ProcessEnv>;
  readonly commandEnvironment?: Readonly<Record<string, string>> | undefined;
  readonly injectedEnvironment?: Readonly<Record<string, string>> | undefined;
  readonly nodeOptionsForbiddenCode:
    | 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN'
    | 'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN';
  readonly databaseUrlDeclarationForbiddenCode?:
    | 'FORMAL_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN'
    | 'SHARED_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN';
  readonly databaseUrlInjectionAuthorized?: boolean;
  readonly databaseUrlInjectionUnauthorizedCode?: string;
}): NodeJS.ProcessEnv {
  assertCommandEnvironmentDoesNotDeclareNodeOptions(
    input.commandEnvironment,
    input.nodeOptionsForbiddenCode,
  );
  assertCommandEnvironmentDoesNotDeclareNodeOptions(
    input.injectedEnvironment,
    input.nodeOptionsForbiddenCode,
  );
  const databaseUrlDeclarationForbiddenCode =
    input.databaseUrlDeclarationForbiddenCode ??
    (input.nodeOptionsForbiddenCode === 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN'
      ? 'FORMAL_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN'
      : 'SHARED_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN');
  assertCommandEnvironmentDoesNotDeclareDatabaseUrl(
    input.commandEnvironment,
    databaseUrlDeclarationForbiddenCode,
  );
  const injectedDatabaseUrl = findEnvironmentEntry(input.injectedEnvironment, 'DATABASE_URL');
  if (injectedDatabaseUrl !== undefined && input.databaseUrlInjectionAuthorized !== true) {
    throw new Error(
      input.databaseUrlInjectionUnauthorizedCode ?? databaseUrlDeclarationForbiddenCode,
    );
  }
  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(input.inheritedEnvironment)) {
    if (
      name.toUpperCase() !== 'NODE_OPTIONS' &&
      name.toUpperCase() !== 'DATABASE_URL' &&
      value !== undefined
    ) {
      environment[name] = value;
    }
  }
  Object.assign(environment, input.commandEnvironment);
  if (input.injectedEnvironment !== undefined) {
    for (const [name, value] of Object.entries(input.injectedEnvironment)) {
      if (name.toUpperCase() === 'DATABASE_URL') {
        environment['DATABASE_URL'] = value;
      } else {
        environment[name] = value;
      }
    }
  }
  return environment;
}

async function assertRepositoryLoaderPath(
  repositoryRoot: string,
  loaderPath: string,
): Promise<void> {
  if (loaderPath !== REPOSITORY_NODE_LOADER_PATH) {
    throw new Error('REPOSITORY_NODE_LOADER_PATH_INVALID');
  }
  const repositoryRelativeLoaderPath = loaderPath.slice(2);
  assertSafeRepositoryRelativePath(
    repositoryRelativeLoaderPath,
    'REPOSITORY_NODE_LOADER_PATH_INVALID',
  );
  await assertRegularRepositoryFile(
    repositoryRoot,
    repositoryRelativeLoaderPath,
    'REPOSITORY_NODE_LOADER_PATH_INVALID',
  );
}

async function assertRegisteredTypeScriptEntry(
  repositoryRoot: string,
  scriptPath: string,
): Promise<void> {
  assertSafeRepositoryRelativePath(
    scriptPath,
    'REPOSITORY_TYPESCRIPT_ENTRY_PATH_INVALID',
  );
  if (!scriptPath.endsWith('.ts')) {
    throw new Error('REPOSITORY_TYPESCRIPT_ENTRY_UNREGISTERED');
  }
  if (!(REPOSITORY_TYPESCRIPT_ENTRY_PATHS as readonly string[]).includes(scriptPath)) {
    throw new Error('REPOSITORY_TYPESCRIPT_ENTRY_UNREGISTERED');
  }
  await assertRegularRepositoryFile(
    repositoryRoot,
    scriptPath,
    'REPOSITORY_TYPESCRIPT_ENTRY_SYMLINK_ESCAPE',
  );
}

async function assertRegularRepositoryFile(
  repositoryRoot: string,
  relativePath: string,
  errorCode: string,
): Promise<void> {
  try {
    const root = await realpath(resolve(repositoryRoot));
    const lexicalPath = resolve(root, relativePath);
    assertInsideRepository(root, lexicalPath, errorCode);
    const observed = await lstat(lexicalPath);
    if (!observed.isFile() || observed.isSymbolicLink()) throw new Error(errorCode);
    const physicalPath = await realpath(lexicalPath);
    assertInsideRepository(root, physicalPath, errorCode);
    if (!samePath(lexicalPath, physicalPath)) throw new Error(errorCode);
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}

function assertSafeRepositoryRelativePath(path: string, errorCode: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('//') ||
    path.startsWith('./') ||
    path.split('/').includes('..')
  ) {
    throw new Error(errorCode);
  }
}

function assertInsideRepository(root: string, path: string, errorCode: string): void {
  const relativePath = relative(root, path);
  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(errorCode);
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function hasNodeOptionsKey(environment: Readonly<Record<string, string>>): boolean {
  return hasEnvironmentKey(environment, 'NODE_OPTIONS');
}

function hasEnvironmentKey(
  environment: Readonly<Record<string, string>>,
  expectedName: string,
): boolean {
  return Object.keys(environment).some((name) => name.toUpperCase() === expectedName);
}

function findEnvironmentEntry(
  environment: Readonly<Record<string, string>> | undefined,
  expectedName: string,
): readonly [string, string] | undefined {
  if (environment === undefined) return undefined;
  const matches = Object.entries(environment).filter(
    ([name]) => name.toUpperCase() === expectedName,
  );
  if (matches.length > 1) throw new Error('CHILD_ENVIRONMENT_NAME_DUPLICATE:' + expectedName);
  return matches[0];
}
