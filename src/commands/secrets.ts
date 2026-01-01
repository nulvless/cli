import type { Command } from 'commander';
import { resources } from '../api/resources';
import type { ContextFactory } from '../context';
import { examples } from '../ui/help';
import { CliError } from '../errors';
import { assertSecretKey, parseAssignment } from '../secret-key';

interface FunctionOption {
  function: string;
}

export function registerSecretCommands(program: Command, context: ContextFactory) {
  const secrets = program
    .command('secrets')
    .description('Manage the secrets of an Edge Function')
    .addHelpText(
      'after',
      examples([
        'nulvless secrets list -f checkout',
        'nulvless secrets set STRIPE_SECRET_KEY -f checkout',
        'nulvless secrets set LOG_LEVEL=debug -f checkout',
        'nulvless secrets unset LOG_LEVEL -f checkout',
      ]),
    );

  secrets
    .command('list')
    .description('List secret names; values are never shown')
    .requiredOption('-f, --function <slug>', 'function the secrets belong to')
    .action(async (options: FunctionOption, command: Command) => {
      const { api, scope, output } = await context(command.optsWithGlobals());

      const target = await scope();
      output.table(
        await output.task(`Loading secrets of ${options.function}`, () => resources.secrets(api, target, options.function)),
        [
          { header: 'KEY', value: (secret) => secret.key },
          { header: 'VERSION', value: (secret) => String(secret.version) },
          {
            header: 'UPDATED',
            value: (secret) => (secret.updated_at ? new Date(secret.updated_at).toLocaleString() : '-'),
          },
        ],
        {
          message: `${options.function} has no secrets yet.`,
          hint: `Add one with \`nulvless secrets set KEY -f ${options.function}\`.`,
        },
      );
    });

  secrets
    .command('set')
    .description('Create or update a secret; omit the value to type it without echo')
    .argument('<KEY[=VALUE]>', 'secret name, optionally with its value')
    .requiredOption('-f, --function <slug>', 'function the secret belongs to')
    .action(async (assignment: string, options: FunctionOption, command: Command) => {
      const { api, scope, output, prompter } = await context(command.optsWithGlobals());

      const parsed = parseAssignment(assignment);
      if (parsed.value === null && !prompter.interactive) {
        throw new CliError(`No value for ${parsed.key}.`, { hint: `Pass it as ${parsed.key}=VALUE.` });
      }
      const value = parsed.value ?? (await prompter.secret(`Value for ${parsed.key}`));

      const target = await scope();
      const secret = await output.task(`Saving ${parsed.key}`, () =>
        resources.setSecret(api, target, options.function, parsed.key, value),
      );
      if (output.json) return output.data(secret);
      output.success(`Saved ${secret.key} (version ${secret.version}). ${options.function} is redeployed with it.`);
    });

  secrets
    .command('unset')
    .description('Remove a secret')
    .argument('<KEY>', 'secret name')
    .requiredOption('-f, --function <slug>', 'function the secret belongs to')
    .action(async (key: string, options: FunctionOption, command: Command) => {
      const { api, scope, output, confirm } = await context(command.optsWithGlobals());

      assertSecretKey(key);
      const target = await scope();
      await confirm(`Remove ${key} from ${options.function}? The function is redeployed without it.`);
      await output.task(`Removing ${key}`, () => resources.unsetSecret(api, target, options.function, key));
      output.success(`Removed ${key}.`);
    });
}
