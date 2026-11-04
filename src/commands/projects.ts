import type { Command } from 'commander';
import { resources, type Domain } from '../api/resources';
import type { ContextFactory } from '../context';
import { examples } from '../ui/help';
import { statusTone } from '../ui/style';

const ALL_SERVICES = ['auth', 'logs', 'communications'];

function dnsRecord(domain: Domain) {
  return domain.dns ? `${domain.dns.type} ${domain.dns.name} → ${domain.dns.value}` : '';
}

export function registerProjectCommands(program: Command, context: ContextFactory) {
  const projects = program
    .command('projects')
    .description('Manage the projects of an organization')
    .addHelpText('after', examples(['nulvless projects list', 'nulvless projects create Store', 'nulvless projects health']));

  projects
    .command('list')
    .description('List the projects of the organization')
    .action(async (_options, command: Command) => {
      const { api, organization, output } = await context(command.optsWithGlobals());

      const org = await organization();
      output.table(
        await output.task(`Loading projects of ${org}`, () => resources.projects(api, org)),
        [
          { header: 'SLUG', value: (project) => project.slug },
          { header: 'NAME', value: (project) => project.name },
          { header: 'STATUS', value: (project) => project.status ?? '', tone: (project) => statusTone(project.status ?? '') },
        ],
        { message: `${org} has no projects yet.`, hint: 'Create one with `nulvless projects create <name>`.' },
      );
    });

  projects
    .command('get')
    .description('Show a project and its environments')
    .action(async (_options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const project = await output.task(`Loading ${target.project}`, () => resources.project(api, target));
      if (output.json) return output.data(project);

      output.info(`${project.name} (${project.slug})${project.status ? `: ${project.status}` : ''}`);
      output.table(
        project.environments,
        [
          { header: 'ENVIRONMENT', value: (environment) => environment.slug },
          { header: 'NAME', value: (environment) => environment.name },
          { header: 'STATUS', value: (environment) => environment.status, tone: (environment) => statusTone(environment.status) },
          { header: 'URL', value: (environment) => environment.url },
        ],
        { message: 'This project has no environments yet.' },
      );
    });

  projects
    .command('create')
    .description('Create a project in the organization')
    .argument('<name>', 'project name')
    .action(async (name: string, _options, command: Command) => {
      const { api, organization, output } = await context(command.optsWithGlobals());

      const org = await organization();
      const project = await output.task(`Creating ${name}`, () =>
        resources.createProject(api, org, { name, services: ALL_SERVICES }),
      );

      if (output.json) return output.data(project);
      output.success(`Created ${project.slug} in ${org}.`);
      output.note(`Use it: nulvless init --org ${org} --project ${project.slug}`);
    });

  projects
    .command('health')
    .description('Check whether each service of the project answers')
    .action(async (_options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        (await output.task(`Checking ${target.project}`, () => resources.projectHealth(api, target))).services,
        [
          { header: 'SERVICE', value: (service) => service.service },
          { header: 'STATUS', value: (service) => service.status, tone: (service) => (service.status === 'up' ? 'good' : 'bad') },
          { header: 'LATENCY', value: (service) => (service.latency_ms === undefined ? '' : `${service.latency_ms}ms`) },
          { header: 'ERROR', value: (service) => service.error?.message ?? '' },
        ],
        { message: 'No services to check.' },
      );
    });

  const lifecycle = [
    {
      action: 'pause' as const,
      description: 'Pause a project; its environments stop answering until restored',
      question: (slug: string) => `Pause ${slug}? Its environments stop answering until you restore it.`,
      progress: 'Pausing',
      done: 'Paused',
    },
    {
      action: 'restore' as const,
      description: 'Restore a paused project',
      question: (slug: string) => `Restore ${slug}? Its environments start answering again.`,
      progress: 'Restoring',
      done: 'Restored',
    },
  ];

  for (const { action, description, question, progress, done } of lifecycle) {
    projects
      .command(action)
      .description(description)
      .argument('<slug>', 'project slug, typed out to confirm which one')
      .action(async (slug: string, _options, command: Command) => {
        const { api, organization, output, confirm } = await context(command.optsWithGlobals());

        const org = await organization();
        await confirm(question(slug));
        await output.task(`${progress} ${slug}`, () => resources.projectAction(api, org, slug, action));
        output.success(`${done} ${slug}.`);
      });
  }

  projects
    .command('delete')
    .description('Delete a project with all its environments, users and data')
    .argument('<slug>', 'project slug, typed out to confirm which one')
    .action(async (slug: string, _options, command: Command) => {
      const { api, organization, output, confirm } = await context(command.optsWithGlobals());

      const org = await organization();
      await confirm(`Delete ${slug} with all its environments, users and data? This cannot be undone.`);
      await output.task(`Deleting ${slug}`, () => resources.deleteProject(api, org, slug));
      output.success(`Deleted ${slug}.`);
    });

  const domains = program
    .command('domains')
    .description('Serve a project on your own domain')
    .addHelpText('after', examples(['nulvless domains list', 'nulvless domains add id.example.com']));

  domains
    .command('list')
    .description('List the custom domains of the project and the DNS record each needs')
    .action(async (_options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading domains of ${target.project}`, () => resources.domains(api, target)),
        [
          { header: 'HOSTNAME', value: (domain) => domain.hostname },
          { header: 'STATUS', value: (domain) => domain.status, tone: (domain) => statusTone(domain.status) },
          { header: 'CERTIFICATE', value: (domain) => domain.certificate ?? '' },
          { header: 'DNS RECORD', value: dnsRecord },
        ],
        { message: `${target.project} has no custom domains.`, hint: 'Add one with `nulvless domains add <hostname>`.' },
      );
    });

  domains
    .command('add')
    .description('Add a custom domain; create the DNS record it prints to verify it')
    .argument('<hostname>', 'domain such as id.example.com')
    .action(async (hostname: string, _options, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      const domain = await output.task(`Adding ${hostname}`, () => resources.addDomain(api, target, hostname));

      if (output.json) return output.data(domain);
      output.success(`Added ${hostname}.`);
      output.note(`Create this DNS record to verify it: ${dnsRecord(domain)}`);
      output.note('Then check it with `nulvless domains list`.');
    });

  domains
    .command('remove')
    .description('Remove a custom domain; requests to it stop being served')
    .argument('<hostname>', 'domain to remove')
    .action(async (hostname: string, _options, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      const target = await scope();
      await confirm(`Remove ${hostname} from ${target.project}? Requests to it stop being served.`);
      await output.task(`Removing ${hostname}`, () => resources.removeDomain(api, target, hostname));
      output.success(`Removed ${hostname}.`);
    });
}
