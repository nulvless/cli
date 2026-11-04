import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWorkspace, initWorkspace, readWorkspaceConfig, writeFiles } from '../workspace';

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
