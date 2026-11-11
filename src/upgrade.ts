import { isOlderVersion } from './examples';

export const PACKAGE = '@nulvless/cli';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type Installation =
  | { kind: 'global'; manager: PackageManager }
  | { kind: 'temporary' }
  | { kind: 'project' };

const TEMPORARY_RUNS = ['/_npx/', '/dlx/', '/bunx-'];

export function installationOf(binaryPath: string): Installation {
  const path = binaryPath.replaceAll('\\', '/').toLowerCase();

  if (TEMPORARY_RUNS.some((marker) => path.includes(marker))) return { kind: 'temporary' };
  if (path.includes('/.bun/install/global/')) return { kind: 'global', manager: 'bun' };
  if (path.includes('/pnpm/global/')) return { kind: 'global', manager: 'pnpm' };
  if (path.includes('/yarn/global/') || path.includes('/yarn/data/global/')) return { kind: 'global', manager: 'yarn' };
  if (path.includes('/lib/node_modules/@nulvless/cli/') || path.includes('/npm/node_modules/@nulvless/cli/')) {
    return { kind: 'global', manager: 'npm' };
  }
  return { kind: 'project' };
}

export function upgradeCommandOf(manager: PackageManager): [string, string[]] {
  const latest = `${PACKAGE}@latest`;
  switch (manager) {
    case 'pnpm':
      return ['pnpm', ['add', '--global', latest]];
    case 'yarn':
      return ['yarn', ['global', 'add', latest]];
    case 'bun':
      return ['bun', ['add', '--global', latest]];
    default:
      return ['npm', ['install', '--global', latest]];
  }
}

export type UpgradePlan =
  | { action: 'none' }
  | { action: 'run'; command: string; args: string[] }
  | { action: 'temporary' }
  | { action: 'project' };

export function planUpgrade(current: string, latest: string, binaryPath: string): UpgradePlan {
  if (!isOlderVersion(current, latest)) return { action: 'none' };

  const installation = installationOf(binaryPath);
  if (installation.kind !== 'global') return { action: installation.kind };

  const [command, args] = upgradeCommandOf(installation.manager);
  return { action: 'run', command, args };
}
