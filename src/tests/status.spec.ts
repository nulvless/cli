import type { ProjectHealth, ProjectOverview } from '../api/resources';
import { sparkline, statusReportOf, type StatusSources } from '../status';

const now = new Date('2026-11-04T12:00:00.000Z');

const overview = (fields: Partial<ProjectOverview> = {}): ProjectOverview => ({
  environment: 'main',
  environments: [
    { name: 'Production', slug: 'main', production: true, status: 'ready', url: 'https://shop.nulvless.co', failed_services: [], custom_domain: { hostname: 'id.shop.com', status: 'active' } },
    { name: 'Staging', slug: 'staging', production: false, status: 'building', url: 'https://shop-staging.nulvless.co', failed_services: [] },
  ],
  issues: [],
  steps: [
    { code: 'api_key', done: true },
    { code: 'first_function', done: false },
  ],
  pulse: {
    users: { sign_ups: 132, active_users: 2401, total_users: 9000 },
    functions: { invocations: 18200, errors: 1292, error_rate: 0.071 },
    messages: { sent: 940, failed: 0, trend: [1, 2, 2, 3, 2, 4, 3, 2] },
    events: null,
  },
  ...fields,
});

const health = (down: string[] = []): ProjectHealth => ({
  status: down.length ? 'degraded' : 'ok',
  checked_at: now.toISOString(),
  services: ['auth', 'edge-functions'].map((service) => ({
    service,
    status: down.includes(service) ? 'down' : 'up',
    latency_ms: 42,
    error: down.includes(service) ? { reason: 'timeout', message: 'timed out' } : null,
  })),
});

const sources = (fields: Partial<StatusSources> = {}): StatusSources => ({
  project: { slug: 'shop', name: 'Shop', status: 'ready', environments: [] },
  overview: overview(),
  health: health(),
  deployments: [],
  consoleUrl: 'https://cloud.nulvless.com',
  ...fields,
});

describe('statusReportOf', () => {
  it('says all is well when there is nothing to fix', () => {
    const report = statusReportOf(sources());

    expect(report.tone).toBe('ok');
    expect(report.headline).toBe('All good in production.');
    expect(report.issues).toEqual([]);
  });

  it('puts problems before warnings and gives each the command that fixes it', () => {
    const report = statusReportOf(
      sources({
        overview: overview({
          issues: [
            { code: 'site_url_localhost', severity: 'warning', service: 'auth' },
            { code: 'deployment_failed', severity: 'problem', deployment_id: 'dep_8f2k', function_slug: 'checkout' },
          ],
        }),
      }),
    );

    expect(report.tone).toBe('problem');
    expect(report.headline).toBe('1 problem needs you.');
    expect(report.issues.map((issue) => issue.code)).toEqual(['deployment_failed', 'site_url_localhost']);
    expect(report.issues[0]).toMatchObject({
      title: 'The checkout deploy failed',
      fix: { command: 'nulvless deployments get dep_8f2k' },
    });
    expect(report.issues[1]?.fix).toEqual({ url: 'https://cloud.nulvless.com/projects/shop/redirects' });
  });

  it('adds --env to the fix when the report is about another environment', () => {
    const report = statusReportOf(
      sources({ overview: overview({ environment: 'staging', issues: [{ code: 'signing_key_missing', severity: 'problem', service: 'auth' }] }) }),
    );

    expect(report.issues[0]?.fix).toEqual({ command: 'nulvless signing-keys create --env staging' });
  });

  it('turns a service that does not answer into a problem', () => {
    const report = statusReportOf(sources({ health: health(['edge-functions']) }));

    expect(report.issues).toEqual([
      expect.objectContaining({
        code: 'service_down',
        severity: 'problem',
        title: 'edge-functions is not responding',
        fix: { command: 'nulvless projects health' },
      }),
    ]);
  });

  it('only warns when there are warnings', () => {
    const report = statusReportOf(
      sources({ overview: overview({ issues: [{ code: 'email_provider_missing', severity: 'warning', service: 'communications', value: 30 }] }) }),
    );

    expect(report.tone).toBe('warning');
    expect(report.headline).toBe('Production is up, with 1 warning.');
    expect(report.issues[0]?.detail).toContain('30 emails per hour');
  });

  it('says the project is still being created instead of judging it', () => {
    const report = statusReportOf(sources({ project: { slug: 'shop', name: 'Shop', status: 'building', environments: [] } }));

    expect(report.tone).toBe('building');
    expect(report.headline).toBe('Your project is being created.');
  });

  it('summarizes the last 24 hours, flagging a high function error rate', () => {
    const report = statusReportOf(sources());

    expect(report.pulse).toEqual([
      { label: 'Sign-ups', value: 132, detail: '2.4K active this month', failing: false },
      { label: 'Function calls', value: 18200, detail: '7.1% errors', failing: true },
      { label: 'Messages sent', value: 940, detail: 'no failures', failing: false, trend: [1, 2, 2, 3, 2, 4, 3, 2] },
    ]);
  });

  it('points to the next setup step', () => {
    const report = statusReportOf(sources());

    expect(report.setup).toEqual({
      done: 1,
      total: 2,
      next: { title: 'Create your first function', fix: { command: 'nulvless functions new hello' } },
    });
  });

  it('shows each environment with its custom domain', () => {
    const report = statusReportOf(sources());

    expect(report.environments).toEqual([
      { slug: 'main', name: 'Production', production: true, tone: 'ok', host: 'shop.nulvless.co', domain: 'id.shop.com' },
      { slug: 'staging', name: 'Staging', production: false, tone: 'building', host: 'shop-staging.nulvless.co', domain: null },
    ]);
  });
});

describe('sparkline', () => {
  it('scales the values to the highest one', () => {
    expect(sparkline([0, 4, 8])).toBe('▁▅█');
  });

  it('draws a flat line when nothing happened', () => {
    expect(sparkline([0, 0, 0])).toBe('▁▁▁');
  });
});
