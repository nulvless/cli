import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWorkspace, initWorkspace, linkWorkspace, readWorkspaceConfig, writeFiles } from '../workspace';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'nulvless-cli-'));
}

describe('initWorkspace', () => {
  it('creates the workspace folder with its config and gitignore', async () => {
    const root = await tempDir();

    const created = await initWorkspace(root, { organization: 'acme', project: 'shop' });

    expect(created).toEqual(['nulvless/nulvless.jsonc', 'nulvless/.gitignore', 'nulvless/functions/', 'nulvless/templates/']);
    await expect(readWorkspaceConfig(root)).resolves.toEqual({ organization: 'acme', project: 'shop', functions: {} });
    await expect(readFile(join(root, 'nulvless/.gitignore'), 'utf8')).resolves.toBe('.env.local\n');
  });

  it('leaves the link out when no organization or project is given', async () => {
    const root = await tempDir();

    await initWorkspace(root, {});

    await expect(readWorkspaceConfig(root)).resolves.toEqual({ functions: {} });
  });

  it('refuses to overwrite an existing workspace', async () => {
    const root = await tempDir();
    await initWorkspace(root, {});

    await expect(initWorkspace(root, {})).rejects.toMatchObject({
      message: 'This folder already has a Nulvless workspace.',
    });
  });

  it('refuses to create a workspace inside the folder of another one', async () => {
    const root = await tempDir();
    await initWorkspace(root, {});

    await expect(initWorkspace(join(root, 'nulvless'), {})).rejects.toMatchObject({
      message: `This folder is inside the Nulvless workspace of ${root}.`,
      hint: `Run commands from ${root}, and link it to a project with \`nulvless link\`.`,
    });
    await expect(findWorkspace(join(root, 'nulvless'))).resolves.toBe(root);
  });

  it('creates a workspace for an app folder of a repository that has one', async () => {
    const root = await tempDir();
    await initWorkspace(root, {});
    await mkdir(join(root, 'apps/web'), { recursive: true });

    await initWorkspace(join(root, 'apps/web'), { project: 'web' });

    await expect(readWorkspaceConfig(join(root, 'apps/web'))).resolves.toEqual({ project: 'web', functions: {} });
  });
});

describe('linkWorkspace', () => {
  it('writes the organization and project and keeps everything else', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'nulvless'));
    await writeFile(
      join(root, 'nulvless/nulvless.jsonc'),
      '{\n  // kept\n  "project": "old",\n  "functions": { "hello": { "secrets": ["KEY"] } },\n}\n',
    );

    await linkWorkspace(root, { organization: 'acme', project: 'shop' });

    const text = await readFile(join(root, 'nulvless/nulvless.jsonc'), 'utf8');
    expect(text).toContain('// kept');
    await expect(readWorkspaceConfig(root)).resolves.toEqual({
      organization: 'acme',
      project: 'shop',
      functions: { hello: { secrets: ['KEY'] } },
    });
  });
});

describe('readWorkspaceConfig', () => {
  it('accepts comments and trailing commas', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'nulvless'));
    await writeFile(join(root, 'nulvless/nulvless.jsonc'), '{\n  // linked by hand\n  "project": "shop",\n}\n');

    await expect(readWorkspaceConfig(root)).resolves.toEqual({ project: 'shop' });
  });

  it('names the file when it cannot be read', async () => {
    const root = await tempDir();
    await mkdir(join(root, 'nulvless'));
    await writeFile(join(root, 'nulvless/nulvless.jsonc'), '{ "project": }');

    await expect(readWorkspaceConfig(root)).rejects.toMatchObject({
      message: 'nulvless/nulvless.jsonc is not valid JSON.',
    });
  });
});

describe('findWorkspace', () => {
  it('finds the workspace from a nested folder', async () => {
    const root = await tempDir();
    await initWorkspace(root, {});
    await mkdir(join(root, 'src/components'), { recursive: true });

    await expect(findWorkspace(join(root, 'src/components'))).resolves.toBe(root);
  });

  it('answers null outside a workspace', async () => {
    await expect(findWorkspace(await tempDir())).resolves.toBeNull();
  });
});

describe('writeFiles', () => {
  it('writes nested files', async () => {
    const target = await tempDir();

    await writeFiles(target, [{ path: 'src/main.ts', content: 'main' }]);

    await expect(readFile(join(target, 'src/main.ts'), 'utf8')).resolves.toBe('main');
  });

  it.each(['../escape.ts', '/etc/passwd', 'src/../../escape.ts'])('refuses to write outside the folder: %s', async (path) => {
    const target = await tempDir();

    await expect(writeFiles(target, [{ path, content: '' }])).rejects.toMatchObject({
      message: `The example tried to write outside its folder (${path}).`,
    });
  });
});
