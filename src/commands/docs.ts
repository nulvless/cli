import type { Command } from 'commander';
import type { ContextFactory } from '../context';
import { readDocs } from '../docs';
import { examples } from '../ui/help';

export function registerDocsCommand(program: Command, context: ContextFactory) {
  program
    .command('docs')
    .description('Print the Nulvless docs as Markdown, for you or your AI agent')
    .argument('[path]', 'page to read, such as sdk/auth (omit to list every page)')
    .addHelpText('after', examples(['nulvless docs', 'nulvless docs quickstart', 'nulvless docs sdk/auth > auth.md']))
    .action(async (path: string | undefined, _options, command: Command) => {
      const { platform, output } = await context(command.optsWithGlobals());

      const markdown = await output.task('Reading the docs', () => readDocs(platform.docsUrl, path));

      if (output.json) return output.data({ path: path ?? null, markdown });
      process.stdout.write(markdown.endsWith('\n') ? markdown : `${markdown}\n`);
    });
}
