import pc from 'picocolors';
import type {
  Deployment,
  OverviewEnvironment,
  OverviewIssue,
  OverviewIssueCode,
  OverviewStepCode,
  Project,
  ProjectHealth,
  ProjectOverview,
} from './api/resources';
import { brand, toned } from './ui/style';

export type StatusTone = 'ok' | 'warning' | 'problem' | 'building';
export type Severity = 'warning' | 'problem';

export interface StatusFix {
  command?: string;
  url?: string;
}

export interface StatusIssue {
  code: OverviewIssueCode | 'service_down';
  severity: Severity;
  title: string;
  detail: string;
  fix: StatusFix;
}

export interface StatusEnvironment {
  slug: string;
  name: string;
  production: boolean;
  tone: 'ok' | 'problem' | 'building';
  host: string | null;
  domain: string | null;
}

export interface StatusPulse {
  label: string;
  value: number;
  detail: string;
  failing: boolean;
  trend?: number[];
}

export interface StatusReport {
  project: { slug: string; name: string };
  environment: string;
  tone: StatusTone;
  headline: string;
  summary: string | null;
  issues: StatusIssue[];
  environments: StatusEnvironment[];
  pulse: StatusPulse[];
  services: { name: string; up: boolean; latency_ms: number | null }[];
  setup: { done: number; total: number; next: { title: string; fix: StatusFix } | null };
}

export interface StatusChanges {
  appeared: StatusIssue[];
  resolved: StatusIssue[];
}

export const issueKey = (issue: StatusIssue) => `${issue.code}:${issue.title}`;

export interface StatusSources {
  project: Project;
  overview: ProjectOverview;
  health: ProjectHealth | null;
  deployments: Deployment[];
  consoleUrl: string;
  now?: Date;
}

const BUILDING_PROJECT_STATUSES = ['building', 'restoring', 'pausing', 'deleting'];
const FUNCTION_ERROR_RATE_THRESHOLD = 0.05;
const SPARK = '▁▂▃▄▅▆▇█';
const MAX_TREND_POINTS = 24;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 });

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function sparkline(values: number[]) {
  const points = values.slice(-MAX_TREND_POINTS);
  const max = Math.max(...points, 0);
  if (max === 0) return SPARK[0]!.repeat(points.length);
  return points.map((value) => SPARK[Math.round((value / max) * (SPARK.length - 1))]).join('');
}

function ago(date: string, now: Date) {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(date).getTime()) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${plural(minutes, 'minute', 'minutes')} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${plural(hours, 'hour', 'hours')} ago`;
  return `${plural(Math.round(hours / 24), 'day', 'days')} ago`;
}

function issueOf(issue: OverviewIssue, env: string, inConsole: (path: string) => StatusFix): StatusIssue {
  const base = { code: issue.code, severity: issue.severity };
  const provider = issue.provider ?? 'A provider';

  switch (issue.code) {
    case 'project_failed':
      return { ...base, title: 'Project setup did not finish', detail: 'Try again from the inConsole. If it keeps failing, delete the project and create another.', fix: inConsole('') };
    case 'project_pause_stalled':
      return { ...base, title: 'Pausing the project did not finish', detail: 'Some services may still be running.', fix: inConsole('') };
    case 'project_delete_stalled':
      return { ...base, title: 'Deleting the project did not finish', detail: 'Some resources may still exist.', fix: inConsole('') };
    case 'environment_failed':
      return {
        ...base,
        title: `The ${issue.environment ?? 'environment'} environment is failing`,
        detail: `${issue.service ?? 'A service'} did not finish setting up.`,
        fix: { command: 'nulvless deployments list --context environments --status failed' },
      };
    case 'deployment_failed':
      return {
        ...base,
        title: issue.function_slug ? `The ${issue.function_slug} deploy failed` : 'A deploy failed',
        detail: 'The previous version is still live.',
        fix: { command: `nulvless deployments get ${issue.deployment_id}` },
      };
    case 'function_errors':
      return {
        ...base,
        title: `Functions are failing ${percent.format(issue.value ?? 0)} of the time`,
        detail: 'Over the last 24 hours; it usually stays below 5%. Roll one back with functions promote.',
        fix: { command: 'nulvless functions list' },
      };
    case 'email_provider_missing':
      return {
        ...base,
        title: 'Sign-in emails use the shared sender',
        detail: `No email provider is enabled, so emails go out from the Nulvless shared sender${
          issue.value === undefined ? ', which has a low hourly limit' : `, limited to ${plural(issue.value, 'email', 'emails')} per hour`
        }.`,
        fix: inConsole('communications/settings'),
      };
    case 'sms_provider_missing':
      return { ...base, title: "Users can't receive sign-in texts", detail: 'Sign-in sends SMS, but no SMS provider is enabled.', fix: inConsole('communications/settings') };
    case 'social_provider_unconfigured':
      return { ...base, title: `${provider} sign-in is on without credentials`, detail: 'Users who choose it will see an error.', fix: inConsole('auth/providers') };
    case 'signing_key_missing':
      return {
        ...base,
        title: 'No active signing key',
        detail: 'Sessions cannot be issued until one is active. Promote it after creating it.',
        fix: { command: `nulvless signing-keys create${env}` },
      };
    case 'site_url_localhost':
      return { ...base, title: 'The site URL points to localhost', detail: 'Emails and redirects will send users to localhost.', fix: inConsole('redirects') };
    case 'payment_gateway_unconfigured':
      return { ...base, title: `${provider} is active without credentials`, detail: 'Payments fail until the credentials are filled in.', fix: inConsole('payments/gateways') };
    case 'payment_webhook_missing':
      return { ...base, title: `${provider} has no webhook secret`, detail: 'Payment confirmations sent later cannot be verified.', fix: inConsole('payments/gateways') };
    case 'custom_domain_failed':
      return {
        ...base,
        title: `${issue.hostname} could not be validated`,
        detail: 'Requests to this domain are not served. Check its DNS record, then remove it and add it again.',
        fix: { command: 'nulvless domains list' },
      };
    case 'custom_domain_suspended':
      return {
        ...base,
        title: `${issue.hostname} is suspended`,
        detail: 'Your plan no longer includes custom domains. Your project URL keeps working.',
        fix: { command: 'nulvless domains list' },
      };
  }
}

const STEPS: Record<OverviewStepCode, { title: string; fix: (env: string, inConsole: (path: string) => StatusFix) => StatusFix }> = {
  api_key: { title: 'Create an API key', fix: (env) => ({ command: `nulvless keys create server --type private${env}` }) },
  sign_in: { title: 'Choose how users sign in', fix: (_env, inConsole) => inConsole('auth/signins') },
  email_provider: { title: 'Set up email sending', fix: (_env, inConsole) => inConsole('communications/settings') },
  first_function: { title: 'Create your first function', fix: () => ({ command: 'nulvless functions new hello' }) },
  payment_gateway: { title: 'Connect a payment gateway', fix: (_env, inConsole) => inConsole('payments/gateways') },
};

function environmentOf(environment: OverviewEnvironment): StatusEnvironment {
  const failing = environment.status === 'error' || environment.failed_services.length > 0;
  return {
    slug: environment.slug,
    name: environment.name,
    production: environment.production,
    tone: failing ? 'problem' : environment.status === 'building' ? 'building' : 'ok',
    host: environment.url?.replace(/^https?:\/\//, '') ?? null,
    domain: environment.custom_domain?.status === 'active' ? environment.custom_domain.hostname : null,
  };
}

function pulseOf(pulse: ProjectOverview['pulse']): StatusPulse[] {
  return [
    ...(pulse.users
      ? [{ label: 'Sign-ups', value: pulse.users.sign_ups, detail: `${compact.format(pulse.users.active_users)} active this month`, failing: false }]
      : []),
    ...(pulse.functions
      ? [
          {
            label: 'Function calls',
            value: pulse.functions.invocations,
            detail: `${percent.format(pulse.functions.error_rate)} errors`,
            failing: pulse.functions.error_rate >= FUNCTION_ERROR_RATE_THRESHOLD,
          },
        ]
      : []),
    ...(pulse.messages
      ? [
          {
            label: 'Messages sent',
            value: pulse.messages.sent,
            detail: pulse.messages.failed ? plural(pulse.messages.failed, 'failure', 'failures') : 'no failures',
            failing: pulse.messages.failed > 0,
            trend: pulse.messages.trend,
          },
        ]
      : []),
    ...(pulse.events
      ? [
          {
            label: 'Log events',
            value: pulse.events.total,
            detail: pulse.events.errors ? plural(pulse.events.errors, 'error', 'errors') : 'no errors',
            failing: pulse.events.errors > 0,
            trend: pulse.events.trend,
          },
        ]
      : []),
  ];
}

function summaryOf(deployment: Deployment | undefined, now: Date) {
  if (!deployment) return null;
  const metadata = deployment.metadata ?? {};
  const target = [metadata.function_slug, metadata.destination, metadata.environment].find((value) => typeof value === 'string');
  return `Last deployment ${ago(deployment.created_at, now)}: ${[target, deployment.short_version].filter(Boolean).join(' ')}, ${deployment.status}.`;
}

export function statusReportOf({ project, overview, health, deployments, consoleUrl, now = new Date() }: StatusSources): StatusReport {
  const production = overview.environments.find((environment) => environment.production)?.slug ?? 'main';
  const onProduction = overview.environment === production;
  const env = onProduction ? '' : ` --env ${overview.environment}`;
  const inConsole = (path: string): StatusFix => ({ url: `${consoleUrl}/projects/${project.slug}${path ? `/${path}` : ''}` });

  const issues: StatusIssue[] = [
    ...overview.issues.map((issue) => issueOf(issue, env, inConsole)),
    ...(health?.services ?? [])
      .filter((service) => service.status === 'down')
      .map((service) => ({
        code: 'service_down' as const,
        severity: 'problem' as const,
        title: `${service.service} is not responding`,
        detail: service.error?.message ?? 'The last health check failed.',
        fix: { command: 'nulvless projects health' },
      })),
  ].sort((first, second) => Number(first.severity === 'warning') - Number(second.severity === 'warning'));

  const problems = issues.filter((issue) => issue.severity === 'problem').length;
  const warnings = issues.length - problems;
  const building = BUILDING_PROJECT_STATUSES.includes(project.status ?? '');
  const place = onProduction ? 'production' : overview.environment;

  const tone: StatusTone = building ? 'building' : problems ? 'problem' : warnings ? 'warning' : 'ok';
  const headline = building
    ? 'Your project is being created.'
    : problems
      ? `${plural(problems, 'problem needs', 'problems need')} you.`
      : warnings
        ? `${capitalize(place)} is up, with ${plural(warnings, 'warning', 'warnings')}.`
        : `All good in ${place}.`;

  const pending = overview.steps.find((step) => !step.done);

  return {
    project: { slug: project.slug, name: project.name },
    environment: overview.environment,
    tone,
    headline,
    summary: summaryOf(deployments[0], now),
    issues,
    environments: overview.environments.map(environmentOf),
    pulse: pulseOf(overview.pulse),
    services: (health?.services ?? []).map((service) => ({
      name: service.service,
      up: service.status === 'up',
      latency_ms: service.latency_ms ?? null,
    })),
    setup: {
      done: overview.steps.filter((step) => step.done).length,
      total: overview.steps.length,
      next: pending ? { title: STEPS[pending.code].title, fix: STEPS[pending.code].fix(env, inConsole) } : null,
    },
  };
}

const TONE_COLORS = { ok: 'good', warning: 'pending', problem: 'bad', building: 'pending' } as const;
const INDENT = '  ';
const DETAIL_INDENT = '    ';

function fixLine(fix: StatusFix, link: (text: string, url: string) => string) {
  if (fix.command) return brand(fix.command);
  return fix.url ? link('Open in the console', fix.url) : '';
}

function columns(rows: string[][]) {
  const widths = rows[0]?.map((_, index) => Math.max(...rows.map((row) => row[index]?.length ?? 0))) ?? [];
  return rows.map((row) =>
    row
      .map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index]!)))
      .join('   ')
      .trimEnd(),
  );
}

const NO_CHANGES: StatusChanges = { appeared: [], resolved: [] };

export function renderStatus(
  report: StatusReport,
  link: (text: string, url: string) => string,
  changes: StatusChanges = NO_CHANGES,
) {
  const appeared = new Set(changes.appeared.map(issueKey));
  const lines: string[] = [];
  const place = report.environments.find((environment) => environment.slug === report.environment)?.name ?? report.environment;

  lines.push(`${pc.bold(report.project.name)}  ${pc.dim(place)}`);
  lines.push(toned(`${report.tone === 'building' ? '◌' : '●'} ${report.headline}`, TONE_COLORS[report.tone]));
  if (report.summary) lines.push(pc.dim(report.summary));

  if (report.issues.length || changes.resolved.length) {
    lines.push('');
    for (const issue of report.issues) {
      const mark = issue.severity === 'problem' ? toned('✗', 'bad') : toned('!', 'pending');
      const fresh = appeared.has(issueKey(issue)) ? ` ${toned('new', 'pending')}` : '';
      lines.push(`${INDENT}${mark} ${issue.title}${fresh}`);
      lines.push(`${DETAIL_INDENT}${pc.dim(issue.detail)}`);
      lines.push(`${DETAIL_INDENT}${fixLine(issue.fix, link)}`);
    }
    for (const issue of changes.resolved) lines.push(`${INDENT}${toned('✓', 'good')} ${issue.title} ${pc.dim('resolved')}`);
  }

  if (report.environments.length) {
    lines.push('', pc.bold('Environments'));
    const rows = report.environments.map((environment) => [
      toned(environment.tone === 'building' ? '◌' : '●', TONE_COLORS[environment.tone]),
      environment.slug,
      environment.tone === 'building' ? 'building' : [environment.host, environment.domain].filter(Boolean).join('  →  '),
    ]);
    const slugWidth = Math.max(...rows.map((row) => row[1]!.length));
    for (const [mark, slug, hosts] of rows) lines.push(`${INDENT}${mark} ${slug!.padEnd(slugWidth)}   ${pc.dim(hosts!)}`);
  }

  if (report.pulse.length) {
    lines.push('', pc.bold('Last 24 hours'));
    const rows = columns(
      report.pulse.map((item) => [item.label, compact.format(item.value), item.detail, item.trend ? sparkline(item.trend) : '']),
    );
    report.pulse.forEach((item, index) => {
      const row = rows[index]!;
      lines.push(`${INDENT}${item.failing ? toned(row, 'bad') : row}`);
    });
  }

  if (report.services.length) {
    lines.push(
      '',
      `${pc.bold('Services')}  ${report.services.map((service) => `${toned('●', service.up ? 'good' : 'bad')} ${service.name}`).join('  ')}`,
    );
  }

  if (report.setup.total) {
    const progress = `${report.setup.done} of ${report.setup.total} done`;
    lines.push(
      '',
      report.setup.next
        ? `${pc.bold('Setup')}  ${progress}, next: ${report.setup.next.title}  ${fixLine(report.setup.next.fix, link)}`
        : `${pc.bold('Setup')}  ${progress}`,
    );
  }

  return lines.join('\n');
}
