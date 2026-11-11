import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTemplates, templateFilesFor, writeTemplate } from '../templates';
import { initWorkspace, pathExists } from '../workspace';

async function workspaceWith(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'nulvless-templates-'));
  await initWorkspace(root, {});
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, 'nulvless/templates', path, '..'), { recursive: true });
    await writeFile(join(root, 'nulvless/templates', path), content);
  }
  return root;
}

describe('readTemplates', () => {
  it('reads every language of every template, with the channel from its folder', async () => {
    const root = await workspaceWith({
      'email/welcome-user/template.json': JSON.stringify({ subject: { 'en-US': 'Hi', 'pt-BR': 'Oi' } }),
      'email/welcome-user/en-US.html': '<p>Hi</p>',
      'email/welcome-user/pt-BR.html': '<p>Oi</p>',
      'sms/login-code/template.json': JSON.stringify({ name: 'Login code' }),
      'sms/login-code/en-US.txt': 'Code {{code}}',
    });

    await expect(readTemplates(root)).resolves.toEqual([
      {
        slug: 'welcome-user',
        channel: 'email',
        versions: [
          { language: 'en-US', subject: 'Hi', content: '<p>Hi</p>' },
          { language: 'pt-BR', subject: 'Oi', content: '<p>Oi</p>' },
        ],
      },
      {
        slug: 'login-code',
        channel: 'sms',
        name: 'Login code',
        versions: [{ language: 'en-US', content: 'Code {{code}}' }],
      },
    ]);
  });

  it('reads an SMS template without a template.json', async () => {
    const root = await workspaceWith({ 'sms/hello-sms/en-US.txt': 'Hi' });

    await expect(readTemplates(root)).resolves.toEqual([
      { slug: 'hello-sms', channel: 'sms', versions: [{ language: 'en-US', content: 'Hi' }] },
    ]);
  });

  it('leaves the languages to the API, so any language file is pushed', async () => {
    const root = await workspaceWith({ 'sms/hello-sms/es-AR.txt': 'Hola', 'sms/hello-sms/ko-KR.txt': '안녕' });

    await expect(readTemplates(root)).resolves.toEqual([
      {
        slug: 'hello-sms',
        channel: 'sms',
        versions: [
          { language: 'es-AR', content: 'Hola' },
          { language: 'ko-KR', content: '안녕' },
        ],
      },
    ]);
  });

  it('selects templates by slug in every channel, or by channel/slug', async () => {
    const root = await workspaceWith({
      'email/code/template.json': JSON.stringify({ subject: { 'en-US': 'Code' } }),
      'email/code/en-US.html': 'a',
      'sms/code/en-US.txt': 'b',
      'sms/other/en-US.txt': 'c',
    });

    const pick = async (selectors: string[]) =>
      (await readTemplates(root, selectors)).map((template) => `${template.channel}/${template.slug}`);

    await expect(pick(['code'])).resolves.toEqual(['email/code', 'sms/code']);
    await expect(pick(['sms/code'])).resolves.toEqual(['sms/code']);
  });

  it('names a template that is not in the workspace', async () => {
    const root = await workspaceWith({});

    await expect(readTemplates(root, ['ghost'])).rejects.toMatchObject({
      message: 'There is no template ghost in nulvless/templates.',
      hint: 'Create it with `nulvless templates new ghost`.',
    });
  });

  it.each([
    [{ 'fax/x-y/en-US.txt': 'Hi' }, 'nulvless/templates/fax is not a channel.'],
    [{ 'sms/x-y/README.md': '# x' }, 'sms/x-y has no language files.'],
    [{ 'sms/x-y/en-US.html': 'Hi' }, 'sms/x-y/en-US.html is not a template file.'],
    [{ 'sms/x-y/.txt': 'Hi' }, 'sms/x-y/.txt is not a template file.'],
    [{ 'email/x-y/en-US.html': 'Hi' }, 'email/x-y/en-US.html has no subject.'],
  ])('refuses a template it cannot push: %j', async (files, message) => {
    const root = await workspaceWith(files);

    await expect(readTemplates(root)).rejects.toMatchObject({ message });
  });
});

describe('writeTemplate', () => {
  it('writes the subjects and one file per language into the channel folder', async () => {
    const root = await workspaceWith({});

    await writeTemplate(root, {
      slug: 'welcome-user',
      channel: 'email',
      versions: [
        { language: 'en-US', subject: 'Hi', content: '<p>Hi</p>' },
        { language: 'pt-BR', subject: 'Oi', content: '<p>Oi</p>' },
      ],
    });

    const folder = join(root, 'nulvless/templates/email/welcome-user');
    expect(JSON.parse(await readFile(join(folder, 'template.json'), 'utf8'))).toEqual({
      subject: { 'en-US': 'Hi', 'pt-BR': 'Oi' },
    });
    await expect(readFile(join(folder, 'pt-BR.html'), 'utf8')).resolves.toBe('<p>Oi</p>');
    await expect(readTemplates(root)).resolves.toHaveLength(1);
  });

  it('skips template.json when there is nothing to put in it', async () => {
    const root = await workspaceWith({});

    await writeTemplate(root, { slug: 'code', channel: 'sms', versions: [{ language: 'en-US', content: 'x' }] });

    await expect(pathExists(join(root, 'nulvless/templates/sms/code/template.json'))).resolves.toBe(false);
  });
});

describe('templateFilesFor', () => {
  it('adds template.json only when it has settings', () => {
    const files = [{ path: 'en-US.txt', content: 'Code {{code}}' }];

    expect(templateFilesFor({}, files)).toEqual(files);
    expect(templateFilesFor({ name: 'Code' }, files)).toEqual([
      { path: 'template.json', content: '{\n  "name": "Code"\n}\n' },
      ...files,
    ]);
  });
});
