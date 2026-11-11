import { installationOf, planUpgrade } from '../upgrade';

const BUNDLE = 'node_modules/@nulvless/cli/dist/index.js';

describe('installationOf', () => {
  it.each([
    [`/usr/local/lib/${BUNDLE}`, 'npm'],
    [`/home/ana/.nvm/versions/node/v24.11.0/lib/${BUNDLE}`, 'npm'],
    [`C:\\Users\\Ana\\AppData\\Roaming\\npm\\${BUNDLE.replaceAll('/', '\\')}`, 'npm'],
    [`/home/ana/.local/share/pnpm/global/5/${BUNDLE}`, 'pnpm'],
    [`/Users/ana/Library/pnpm/global/5/.pnpm/@nulvless+cli@0.3.13/${BUNDLE}`, 'pnpm'],
    [`/home/ana/.config/yarn/global/${BUNDLE}`, 'yarn'],
    [`C:\\Users\\Ana\\AppData\\Local\\Yarn\\Data\\global\\${BUNDLE.replaceAll('/', '\\')}`, 'yarn'],
    [`/home/ana/.bun/install/global/${BUNDLE}`, 'bun'],
  ])('knows %s was installed globally with %s', (path, manager) => {
    expect(installationOf(path)).toEqual({ kind: 'global', manager });
  });

  it.each([
    `/home/ana/.npm/_npx/2f1a/${BUNDLE}`,
    `/home/ana/.cache/pnpm/dlx/9c3e/${BUNDLE}`,
    `/tmp/bunx-1000-@nulvless/cli@latest/${BUNDLE}`,
  ])('knows %s is a one-off run', (path) => {
    expect(installationOf(path)).toEqual({ kind: 'temporary' });
  });

  it('knows a CLI inside a project comes from its dependencies', () => {
    expect(installationOf(`/home/ana/shop/${BUNDLE}`)).toEqual({ kind: 'project' });
  });
});

describe('planUpgrade', () => {
  it('does nothing when the latest version is already installed', () => {
    expect(planUpgrade('0.3.13', '0.3.13', `/usr/local/lib/${BUNDLE}`)).toEqual({ action: 'none' });
    expect(planUpgrade('0.4.0', '0.3.13', `/usr/local/lib/${BUNDLE}`)).toEqual({ action: 'none' });
  });

  it.each([
    [`/usr/local/lib/${BUNDLE}`, 'npm', ['install', '--global', '@nulvless/cli@latest']],
    [`/home/ana/.local/share/pnpm/global/5/${BUNDLE}`, 'pnpm', ['add', '--global', '@nulvless/cli@latest']],
    [`/home/ana/.config/yarn/global/${BUNDLE}`, 'yarn', ['global', 'add', '@nulvless/cli@latest']],
    [`/home/ana/.bun/install/global/${BUNDLE}`, 'bun', ['add', '--global', '@nulvless/cli@latest']],
  ])('upgrades %s with the package manager that installed it', (path, command, args) => {
    expect(planUpgrade('0.3.12', '0.3.13', path)).toEqual({ action: 'run', command, args });
  });

  it('leaves one-off runs and project dependencies to the user', () => {
    expect(planUpgrade('0.3.12', '0.3.13', `/home/ana/.npm/_npx/2f1a/${BUNDLE}`)).toEqual({ action: 'temporary' });
    expect(planUpgrade('0.3.12', '0.3.13', `/home/ana/shop/${BUNDLE}`)).toEqual({ action: 'project' });
  });
});
