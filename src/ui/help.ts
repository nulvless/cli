import pc from 'picocolors';

export function examples(commands: string[]) {
  return `\n${pc.bold('Examples:')}\n${commands.map((command) => `  ${pc.dim('$')} ${command}`).join('\n')}\n`;
}
