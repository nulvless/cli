import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StoredTemplate } from './api/resources';
import { CliError } from './errors';
import type { ExampleFile } from './examples';
import { pathExists, TEMPLATES_DIR, WORKSPACE_DIR, writeFiles } from './workspace';

export type TemplateChannel = 'email' | 'sms';
export type TemplateLanguage = 'en-US' | 'pt-BR';

export const TEMPLATES_PATH = `${WORKSPACE_DIR}/${TEMPLATES_DIR}`;
export const TEMPLATE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const TEMPLATE_CHANNELS: TemplateChannel[] = ['email', 'sms'];

const SETTINGS_FILE = 'template.json';
const DEFAULT_LANGUAGE: TemplateLanguage = 'en-US';
const LANGUAGES: TemplateLanguage[] = ['en-US', 'pt-BR'];
const EXTENSIONS: Record<TemplateChannel, string> = { email: 'html', sms: 'txt' };
const IGNORED_FILES = new Set([SETTINGS_FILE, 'README.md']);

export interface TemplateSettings {
  name?: string;
  description?: string;
  subject?: Partial<Record<TemplateLanguage, string>>;
}

export interface TemplateVersion {
  language: TemplateLanguage;
  subject?: string;
  content: string;
}

export interface WorkspaceTemplate {
  slug: string;
  channel: TemplateChannel;
  name?: string;
  description?: string;
  versions: TemplateVersion[];
}

interface TemplateLocation {
  channel: TemplateChannel;
  slug: string;
}

export function workspaceTemplatesOf(stored: StoredTemplate[]): WorkspaceTemplate[] {
  const templates = new Map<string, WorkspaceTemplate>();

  for (const entry of stored) {
    const template = templates.get(entry.slug) ?? {
      slug: entry.slug,
      channel: entry.channel,
      ...(!entry.common && entry.name ? { name: entry.name } : {}),
      ...(!entry.common && entry.description ? { description: entry.description } : {}),
      versions: [],
    };
    template.versions.push({
      language: entry.language,
      ...(entry.subject ? { subject: entry.subject } : {}),
      content: entry.content,
    });
    templates.set(entry.slug, template);
  }

  return [...templates.values()];
}

export function templatePath(channel: TemplateChannel, slug: string) {
  return `${TEMPLATES_PATH}/${channel}/${slug}`;
}

export const starterTemplate: Record<TemplateChannel, (slug: string) => ExampleFile[]> = {
  email: (slug) =>
    templateFilesFor({ name: slug, subject: { 'en-US': 'A message from {{platform.name}}' } }, [
      {
        path: 'en-US.html',
        content: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:460px;margin:0 auto;padding:40px">
  <h1 style="font-size:24px;margin:0 0 16px">Hello from {{platform.name}}</h1>
  <p style="font-size:16px;line-height:24px;color:#444444;margin:0">Write your message here.</p>
</div>
`,
      },
    ]),
  sms: (slug) => templateFilesFor({ name: slug }, [{ path: 'en-US.txt', content: '{{platform.name}}: write your message here.\n' }]),
};

export function templateFilesFor(settings: TemplateSettings, files: ExampleFile[]): ExampleFile[] {
  if (!Object.keys(settings).length) return files;
  return [{ path: SETTINGS_FILE, content: `${JSON.stringify(settings, null, 2)}\n` }, ...files];
}

async function subfolders(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function localTemplates(root: string): Promise<TemplateLocation[]> {
  const locations: TemplateLocation[] = [];
  for (const channel of await subfolders(join(root, TEMPLATES_PATH))) {
    if (!TEMPLATE_CHANNELS.includes(channel as TemplateChannel)) {
      throw new CliError(`${TEMPLATES_PATH}/${channel} is not a channel.`, {
        hint: `Put templates in ${TEMPLATE_CHANNELS.map((entry) => `${TEMPLATES_PATH}/${entry}`).join(' or ')}.`,
      });
    }
    for (const slug of await subfolders(join(root, TEMPLATES_PATH, channel))) {
      locations.push({ channel: channel as TemplateChannel, slug });
    }
  }
  return locations;
}

function select(locations: TemplateLocation[], selectors: string[]) {
  if (!selectors.length) return locations;

  return selectors.flatMap((selector) => {
    const matches = locations.filter(
      (location) => selector === location.slug || selector === `${location.channel}/${location.slug}`,
    );
    if (!matches.length) {
      const slug = selector.split('/').pop();
      throw new CliError(`There is no template ${selector} in ${TEMPLATES_PATH}.`, {
        hint: `Create it with \`nulvless templates new ${slug}\`.`,
      });
    }
    return matches;
  });
}

async function readSettings(folder: string): Promise<TemplateSettings> {
  const settingsPath = join(folder, SETTINGS_FILE);
  return (await pathExists(settingsPath)) ? (JSON.parse(await readFile(settingsPath, 'utf8')) as TemplateSettings) : {};
}

async function readTemplate(root: string, { channel, slug }: TemplateLocation): Promise<WorkspaceTemplate> {
  const label = `${channel}/${slug}`;
  const folder = join(root, TEMPLATES_PATH, channel, slug);
  const settings = await readSettings(folder);
  const extension = EXTENSIONS[channel];
  const files = (await readdir(folder)).filter((file) => !IGNORED_FILES.has(file)).sort();
  if (!files.length) {
    throw new CliError(`${label} has no language files.`, { hint: `Add ${DEFAULT_LANGUAGE}.${extension}.` });
  }

  const versions: TemplateVersion[] = [];
  for (const file of files) {
    const language = LANGUAGES.find((candidate) => file === `${candidate}.${extension}`);
    if (!language) {
      throw new CliError(`${label}/${file} is not a template file.`, {
        hint: `Name files <language>.${extension} with ${LANGUAGES.join(' or ')}.`,
      });
    }

    const subject = settings.subject?.[language];
    if (channel === 'email' && !subject) {
      throw new CliError(`${label}/${file} has no subject.`, { hint: `Add "${language}" to subject in ${SETTINGS_FILE}.` });
    }

    const content = await readFile(join(folder, file), 'utf8');
    versions.push(channel === 'email' && subject ? { language, subject, content } : { language, content });
  }

  return {
    slug,
    channel,
    ...(settings.name ? { name: settings.name } : {}),
    ...(settings.description ? { description: settings.description } : {}),
    versions,
  };
}

export async function readTemplates(root: string, selectors: string[] = []): Promise<WorkspaceTemplate[]> {
  const locations = select(await localTemplates(root), selectors);
  return Promise.all(locations.map((location) => readTemplate(root, location)));
}

export async function writeTemplate(root: string, template: WorkspaceTemplate) {
  const extension = EXTENSIONS[template.channel];
  const subjects = template.versions.filter((version) => version.subject);
  const settings: TemplateSettings = {
    ...(template.name ? { name: template.name } : {}),
    ...(template.description ? { description: template.description } : {}),
    ...(subjects.length ? { subject: Object.fromEntries(subjects.map((version) => [version.language, version.subject])) } : {}),
  };

  await writeFiles(
    join(root, templatePath(template.channel, template.slug)),
    templateFilesFor(
      settings,
      template.versions.map((version) => ({ path: `${version.language}.${extension}`, content: version.content })),
    ),
  );
}
