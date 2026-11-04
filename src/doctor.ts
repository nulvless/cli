import { isOlderVersion } from './examples';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface WorkspaceLinkSummary {
  root: string;
  organization?: string;
  project?: string;
}

export interface DoctorProbes {
  nodeVersion: string;
  cliVersion: string;
  latestVersion: () => Promise<string | null>;
  usingToken: boolean;
  sessionLocation: string;
  account: () => Promise<string>;
  apiReachable: () => Promise<boolean>;
  workspace: () => Promise<WorkspaceLinkSummary | null>;
  projectAccessible: (organization: string, project: string) => Promise<boolean>;
}

const MINIMUM_NODE = '20.0.0';

async function signInCheck(probes: DoctorProbes): Promise<Check> {
  try {
    const account = await probes.account();
    return {
      name: 'Sign-in',
      status: 'ok',
      detail: probes.usingToken ? `${account}, with NULVLESS_TOKEN` : `${account}, stored in ${probes.sessionLocation}`,
    };
  } catch (error) {
    return {
      name: 'Sign-in',
      status: 'fail',
      detail: (error as Error).message,
      fix: probes.usingToken ? 'Create a new token, or unset NULVLESS_TOKEN and run `nulvless login`.' : 'nulvless login',
    };
  }
}

export async function runChecks(probes: DoctorProbes): Promise<Check[]> {
  const checks: Check[] = [];

  checks.push(
    isOlderVersion(probes.nodeVersion, MINIMUM_NODE)
      ? { name: 'Node.js', status: 'fail', detail: probes.nodeVersion, fix: 'Install Node.js 20 or later.' }
      : { name: 'Node.js', status: 'ok', detail: probes.nodeVersion },
  );

  const latest = await probes.latestVersion();
  checks.push(
    latest && isOlderVersion(probes.cliVersion, latest)
      ? {
          name: 'CLI version',
          status: 'warn',
          detail: `${probes.cliVersion}, ${latest} is available`,
          fix: 'npm install --global @nulvless/cli@latest',
        }
      : { name: 'CLI version', status: 'ok', detail: probes.cliVersion },
  );

  const reachable = await probes.apiReachable();
  checks.push(
    reachable
      ? { name: 'Nulvless API', status: 'ok', detail: 'reachable' }
      : { name: 'Nulvless API', status: 'fail', detail: 'not reachable', fix: 'Check your connection, proxy or NULVLESS_API_URL.' },
  );

  const signIn = await signInCheck(probes);
  checks.push(signIn);

  const workspace = await probes.workspace();
  if (!workspace) {
    checks.push({ name: 'Workspace', status: 'warn', detail: 'none in this folder', fix: 'nulvless init' });
    return checks;
  }
  if (!workspace.organization || !workspace.project) {
    checks.push({
      name: 'Workspace',
      status: 'warn',
      detail: `${workspace.root}, no project linked`,
      fix: 'Add "organization" and "project" to nulvless/nulvless.jsonc, or pass --org and --project.',
    });
    return checks;
  }
  checks.push({ name: 'Workspace', status: 'ok', detail: `${workspace.root}, linked to ${workspace.organization}/${workspace.project}` });

  if (!reachable || signIn.status !== 'ok') return checks;
  const accessible = await probes.projectAccessible(workspace.organization, workspace.project);
  checks.push(
    accessible
      ? { name: 'Project', status: 'ok', detail: `${workspace.organization}/${workspace.project}` }
      : {
          name: 'Project',
          status: 'fail',
          detail: `${workspace.organization}/${workspace.project} is not accessible`,
          fix: 'Check the slugs in nulvless/nulvless.jsonc, or ask an owner of the organization for access.',
        },
  );

  return checks;
}
