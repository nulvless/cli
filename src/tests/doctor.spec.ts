import { runChecks, type DoctorProbes } from '../doctor';

function probes(overrides: Partial<DoctorProbes> = {}): DoctorProbes {
  return {
    nodeVersion: '22.11.0',
    cliVersion: '0.3.0',
    latestVersion: async () => '0.3.0',
    usingToken: false,
    sessionLocation: 'the system keychain',
    account: async () => 'ada@acme.com',
    apiReachable: async () => true,
    workspace: async () => ({ root: '/repo', organization: 'acme', project: 'shop' }),
    projectAccessible: async () => true,
    ...overrides,
  };
}

describe('runChecks', () => {
  it('passes every check on a healthy setup', async () => {
    const checks = await runChecks(probes());

    expect(checks.map((check) => [check.name, check.status])).toEqual([
      ['Node.js', 'ok'],
      ['CLI version', 'ok'],
      ['Nulvless API', 'ok'],
      ['Sign-in', 'ok'],
      ['Workspace', 'ok'],
      ['Project', 'ok'],
    ]);
  });

  it('names the fix for each problem', async () => {
    const checks = await runChecks(
      probes({
        nodeVersion: '18.19.0',
        latestVersion: async () => '0.4.0',
        apiReachable: async () => false,
        account: async () => {
          throw new Error('You are not signed in.');
        },
        workspace: async () => null,
      }),
    );

    expect(checks).toEqual([
      { name: 'Node.js', status: 'fail', detail: '18.19.0', fix: 'Install Node.js 20 or later.' },
      { name: 'CLI version', status: 'warn', detail: '0.3.0, 0.4.0 is available', fix: 'nulvless upgrade' },
      { name: 'Nulvless API', status: 'fail', detail: 'not reachable', fix: 'Check your connection, proxy or NULVLESS_API_URL.' },
      { name: 'Sign-in', status: 'fail', detail: 'You are not signed in.', fix: 'nulvless login' },
      { name: 'Workspace', status: 'warn', detail: 'none in this folder', fix: 'nulvless init' },
    ]);
  });

  it('reports a workspace without a linked project, and a project you cannot reach', async () => {
    const unlinked = await runChecks(probes({ workspace: async () => ({ root: '/repo' }) }));
    expect(unlinked.at(-1)).toEqual({
      name: 'Workspace',
      status: 'warn',
      detail: '/repo, no project linked',
      fix: 'Add "organization" and "project" to nulvless/nulvless.jsonc, or pass --org and --project.',
    });

    const unreachable = await runChecks(probes({ projectAccessible: async () => false }));
    expect(unreachable.at(-1)).toMatchObject({ name: 'Project', status: 'fail', detail: 'acme/shop is not accessible' });
  });

  it('mentions NULVLESS_TOKEN when it is in use', async () => {
    const checks = await runChecks(probes({ usingToken: true }));

    expect(checks.find((check) => check.name === 'Sign-in')?.detail).toBe('ada@acme.com, with NULVLESS_TOKEN');
  });
});
