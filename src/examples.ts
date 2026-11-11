import { CliError } from './errors';

export type ExampleKind = 'function' | 'app' | 'template';

export interface Example {
  name: string;
  kind: ExampleKind;
  path: string;
  title: string;
  description: string;
  features: string[];
  frameworks: string[];
  secrets: string[];
  minCliVersion: string;
  files: string[];
  template?: {
    channel: 'email' | 'sms';
    subject?: Record<string, string>;
    variables: string[];
  };
}

export interface ExampleFile {
  path: string;
  content: string;
}

export type FetchText = (url: string) => Promise<Response>;

const CATALOG_VERSION = 1;
const UPDATE_HINT = 'Update with `nulvless upgrade`.';

const EXAMPLES_REPOSITORY_URL = 'https://github.com/nulvless/examples/tree/main';

const howToUse: Record<ExampleKind, (example: Example) => string> = {
  function: (example) => `Run \`nulvless functions new <slug> --template ${example.name}\`.`,
  app: (example) => `Run \`nulvless create <dir> --example ${example.name}\`.`,
  template: (example) =>
    `Paste it into Communications → Templates in the console: ${EXAMPLES_REPOSITORY_URL}/${example.path}`,
};

const article: Record<ExampleKind, string> = {
  function: 'a function',
  app: 'an app',
  template: 'a communication template',
};

async function request(url: string, fetchImpl: FetchText) {
  return fetchImpl(url).catch(() => {
    throw new CliError(`Could not reach the Nulvless examples at ${new URL(url).host}.`, {
      hint: 'Check your connection and try again.',
    });
  });
}

export async function fetchCatalog(examplesUrl: string, fetchImpl: FetchText = fetch): Promise<Example[]> {
  const response = await request(`${examplesUrl}/catalog.json`, fetchImpl);
  if (!response.ok) throw new CliError(`The Nulvless examples answered with status ${response.status}.`);

  const catalog = (await response.json()) as { version: number; examples: Example[] };
  if (catalog.version !== CATALOG_VERSION) {
    throw new CliError('This version of the CLI cannot read the examples catalog.', { hint: UPDATE_HINT });
  }

  return catalog.examples;
}

function versionParts(version: string) {
  return (version.split('-')[0] ?? '').split('.').map(Number);
}

export function isOlderVersion(current: string, required: string) {
  const have = versionParts(current);
  const need = versionParts(required);

  for (let index = 0; index < need.length; index++) {
    const difference = (have[index] ?? 0) - (need[index] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

export function findExample(catalog: Example[], name: string, kind: ExampleKind, cliVersion: string) {
  const example = catalog.find((entry) => entry.name === name);

  if (!example) {
    throw new CliError(`There is no ${kind} example named ${name}.`, { hint: 'Run `nulvless examples` to see every example.' });
  }
  if (example.kind !== kind) {
    throw new CliError(`${name} is ${article[example.kind]}, not ${article[kind]}.`, {
      hint: howToUse[example.kind](example),
    });
  }
  if (isOlderVersion(cliVersion, example.minCliVersion)) {
    throw new CliError(`${name} needs Nulvless CLI ${example.minCliVersion} or later. You have ${cliVersion}.`, {
      hint: UPDATE_HINT,
    });
  }

  return example;
}

export async function downloadExample(
  examplesUrl: string,
  example: Example,
  fetchImpl: FetchText = fetch,
): Promise<ExampleFile[]> {
  return Promise.all(
    example.files.map(async (path) => {
      const response = await request(`${examplesUrl}/${example.path}/${path}`, fetchImpl);
      if (!response.ok) throw new CliError(`Could not download ${path} of ${example.name}.`);
      return { path, content: await response.text() };
    }),
  );
}
