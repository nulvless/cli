import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';
import { CliError } from './errors';
import type { ExampleFile } from './examples';

export const WORKSPACE_DIR = 'nulvless';
export const CONFIG_FILE = 'nulvless.jsonc';
export const FUNCTIONS_DIR = 'functions';
export const TEMPLATES_DIR = 'templates';
export const WORKSPACE_SCHEMA_URL = 'https://cdn.jsdelivr.net/npm/@nulvless/cli/schema/workspace.schema.json';

const CONFIG_PATH = `${WORKSPACE_DIR}/${CONFIG_FILE}`;
const FUNCTIONS_PATH = `${WORKSPACE_DIR}/${FUNCTIONS_DIR}`;
const DEPLOYABLE_FILE = /(\.(ts|tsx|js|jsx|mjs)|^deno\.jsonc?|^\.npmrc)$/;
const SHARED_FOLDER_PREFIX = '_';
const LOCAL_ENV_FILE = '.env.local';

export interface WorkspaceLink {
  organization?: string;
  project?: string;
}

export interface WorkspaceConfig extends WorkspaceLink {
  functions?: Record<string, { name?: string; secrets?: string[] }>;
}

export const STARTER_FUNCTION: ExampleFile[] = [
  {
    path: 'index.ts',
    content: `export default async function handler(req: Request): Promise<Response> {
  const name = new URL(req.url).searchParams.get('name') ?? 'world';

  return Response.json({ message: \`Hello, \${name}!\` });
}
`,
  },
];

export async function pathExists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

function renderConfig(link: WorkspaceLink) {
  const config = { $schema: WORKSPACE_SCHEMA_URL, ...link, functions: {} };
  return `${JSON.stringify(config, null, 2)}\n`;
}

export function assertFolderName(name: string) {
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw new CliError(`${name} cannot be a folder name.`, { hint: 'Use a name without slashes, such as send-email.' });
  }
}

export async function initWorkspace(root: string, link: WorkspaceLink) {
  if (await pathExists(join(root, CONFIG_PATH))) {
    throw new CliError('This folder already has a Nulvless workspace.', { hint: `Edit ${CONFIG_PATH} instead.` });
  }

  await mkdir(join(root, WORKSPACE_DIR, FUNCTIONS_DIR), { recursive: true });
  await mkdir(join(root, WORKSPACE_DIR, TEMPLATES_DIR), { recursive: true });
  await writeFile(join(root, CONFIG_PATH), renderConfig(link));
  await writeFile(join(root, WORKSPACE_DIR, '.gitignore'), `${LOCAL_ENV_FILE}\n`);

  return [CONFIG_PATH, `${WORKSPACE_DIR}/.gitignore`, `${WORKSPACE_DIR}/${FUNCTIONS_DIR}/`, `${WORKSPACE_DIR}/${TEMPLATES_DIR}/`];
}

export async function readWorkspaceConfig(root: string): Promise<WorkspaceConfig> {
  const errors: ParseError[] = [];
  const config = parse(await readFile(join(root, CONFIG_PATH), 'utf8'), errors, { allowTrailingComma: true });

  if (errors.length || typeof config !== 'object' || config === null) {
    const reason = errors[0] ? ` (${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset})` : '';
    throw new CliError(`${CONFIG_PATH} is not valid JSON.`, { hint: `Fix the file${reason}.` });
  }

  const workspace = { ...(config as WorkspaceConfig & { $schema?: string }) };
  delete workspace.$schema;
  return workspace as WorkspaceConfig;
}

export async function findWorkspace(from: string): Promise<string | null> {
  let directory = resolve(from);

  while (true) {
    if (await pathExists(join(directory, CONFIG_PATH))) return directory;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export async function writeFiles(target: string, files: ExampleFile[]) {
  const root = resolve(target);

  for (const file of files) {
    const destination = resolve(root, file.path);
    const inside = relative(root, destination);
    if (isAbsolute(file.path) || !inside || inside.startsWith('..') || isAbsolute(inside)) {
      throw new CliError(`The example tried to write outside its folder (${file.path}).`);
    }
  }

  for (const file of files) {
    const destination = resolve(root, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.content);
  }
}

export interface FunctionSource {
  path: string;
  content: Buffer;
}

export async function functionSlugs(root: string) {
  const entries = await readdir(join(root, FUNCTIONS_PATH), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(SHARED_FOLDER_PREFIX))
    .map((entry) => entry.name)
    .sort();
}

export async function readFunctionSources(root: string, slug: string): Promise<FunctionSource[]> {
  const directory = join(root, FUNCTIONS_PATH, slug);
  if (!(await pathExists(directory))) {
    throw new CliError(`There is no function ${slug} in ${FUNCTIONS_PATH}.`, {
      hint: `Create it with \`nulvless functions new ${slug}\`.`,
    });
  }

  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split('\\').join('/'));

  const nested = files.filter((path) => path.includes('/'));
  if (nested.length) {
    throw new CliError(`${slug} has files in subfolders (${nested.join(', ')}), which Edge Functions do not support yet.`, {
      hint: 'Move them next to index.ts.',
    });
  }

  return Promise.all(
    files
      .filter((path) => DEPLOYABLE_FILE.test(path))
      .sort()
      .map(async (path) => ({ path, content: await readFile(join(directory, path)) })),
  );
}
