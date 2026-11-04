import type { Command } from 'commander';
import type { ContextFactory } from '../context';
import { CliError } from '../errors';
import { examples } from '../ui/help';

export function registerFeedbackCommand(program: Command, context: ContextFactory, version: string) {
  program
    .command('feedback')
    .description('Tell the Nulvless team what works, what is missing or what broke')
    .argument('[message...]', 'your feedback (asked when omitted)')
    .addHelpText('after', examples(['nulvless feedback "status should show the logs too"', 'nulvless feedback']))
    .action(async (words: string[], _options, command: Command) => {
      const { api, output, prompter } = await context(command.optsWithGlobals());

      if (!words.length && !prompter.interactive) {
        throw new CliError('Write your feedback.', { hint: 'Pass it as an argument: nulvless feedback "your message"' });
      }
      const feedback = (words.length ? words.join(' ') : await prompter.text('What would you like to tell us?')).trim();

      await output.task('Sending your feedback', () =>
        api.post('/organizations/feedback', { body: { feedback, path: `cli/${version}` } }),
      );

      if (output.json) return output.data({ sent: true });
      output.success('Thanks, your feedback was sent.');
    });
}
