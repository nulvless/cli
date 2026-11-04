import { confirm, isCancel, password, select, text } from '@clack/prompts';
import { CancelledError } from '../errors';

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface Prompter {
  interactive: boolean;
  choose<T>(message: string, choices: Choice<T>[]): Promise<T>;
  confirm(message: string): Promise<boolean>;
  secret(message: string): Promise<string>;
  text(message: string): Promise<string>;
}

function answered<T>(value: T | symbol): T {
  if (isCancel(value)) throw new CancelledError();
  return value as T;
}

export function isInteractive(env: NodeJS.ProcessEnv) {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !env.CI);
}

export function terminalPrompter(interactive: boolean): Prompter {
  return {
    interactive,
    async choose(message, choices) {
      const options = choices.map((choice) => ({
        value: choice.value,
        label: choice.label,
        ...(choice.hint ? { hint: choice.hint } : {}),
      }));
      return answered(await select({ message, options } as Parameters<typeof select>[0])) as never;
    },
    async confirm(message) {
      return answered(await confirm({ message, initialValue: false }));
    },
    async secret(message) {
      return answered(await password({ message }));
    },
    async text(message) {
      return answered(await text({ message }));
    },
  };
}
