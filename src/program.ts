import { Command } from 'commander';
import pc from 'picocolors';
import { registerAuthCommands } from './commands/auth';
import { registerDeploymentCommands } from './commands/deployments';
import { registerDocsCommand } from './commands/docs';
import { registerDoctorCommand } from './commands/doctor';
import { registerEnvironmentCommands } from './commands/environments';
import { registerFunctionCommands } from './commands/functions';
import { registerKeyCommands } from './commands/keys';
import { registerOAuthCommands } from './commands/oauth';
import { registerOrganizationCommands } from './commands/organizations';
import { registerProjectCommands } from './commands/projects';
import { registerSecretCommands } from './commands/secrets';
import { registerStatusCommands } from './commands/status';
import { registerTemplateCommands } from './commands/templates';
import { registerUserCommands } from './commands/users';
import { registerWorkspaceCommands } from './commands/workspace';
import type { ContextFactory } from './context';
import { renderCommanderFailure } from './ui/failure';
import { examples } from './ui/help';
import { brand } from './ui/style';

export function buildProgram(context: ContextFactory, version: string) {
  const program = new Command('nulvless')
    .description('Manage Nulvless projects from the terminal')
    .version(version, '-v, --version', 'show the version')
    .helpOption('-h, --help', 'show help for a command')
    .helpCommand('help [command]', 'show help for a command')
    .option('--org <slug>', 'organization to act on (or NULVLESS_ORG)')
    .option('--project <slug>', 'project to act on (or NULVLESS_PROJECT)')
    .option('--json', 'print machine-readable JSON')
    .option('-y, --yes', 'skip confirmation prompts')
    .configureHelp({
      styleTitle: (title) => pc.bold(title),
      styleCommandText: (text) => brand(text),
      styleSubcommandTerm: (term) => brand(term),
    })
    .configureOutput({
      outputError: (text, write) => write(renderCommanderFailure(text)),
    })
    .addHelpText(
      'after',
      examples([
        'nulvless login',
        'nulvless init',
        'nulvless functions new whoami --template verify-session',
        'nulvless create my-app --example auth-nextjs',
        'nulvless environments list --project shop',
        'nulvless secrets set STRIPE_SECRET_KEY --function checkout',
        'nulvless functions list --json',
        'nulvless docs quickstart',
      ]),
    );

  program.hook('preAction', async (_program, action) => {
    const { output } = await context(action.optsWithGlobals());
    output.banner(version);
  });

  registerAuthCommands(program, context);
  registerWorkspaceCommands(program, context, version);
  registerEnvironmentCommands(program, context);
  registerFunctionCommands(program, context, version);
  registerDeploymentCommands(program, context);
  registerKeyCommands(program, context);
  registerOAuthCommands(program, context);
  registerProjectCommands(program, context);
  registerOrganizationCommands(program, context);
  registerUserCommands(program, context);
  registerSecretCommands(program, context);
  registerTemplateCommands(program, context, version);
  registerStatusCommands(program, context);
  registerDocsCommand(program, context);
  registerDoctorCommand(program, context, version);

  return program;
}
