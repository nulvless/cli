export const ExitCode = {
  Ok: 0,
  Failure: 1,
  Unauthorized: 2,
  Interrupted: 130,
} as const;

export interface CliErrorOptions {
  exitCode?: number;
  hint?: string;
}

export class CliError extends Error {
  readonly exitCode: number;
  readonly hint: string | undefined;

  constructor(message: string, { exitCode = ExitCode.Failure, hint }: CliErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export class NotSignedInError extends CliError {
  constructor() {
    super('You are not signed in.', { exitCode: ExitCode.Unauthorized, hint: 'Run `nulvless login` to sign in.' });
  }
}

export class SessionExpiredError extends CliError {
  constructor() {
    super('Your session expired.', { exitCode: ExitCode.Unauthorized, hint: 'Run `nulvless login` to sign in again.' });
  }
}

export class TokenRejectedError extends CliError {
  constructor() {
    super('The API rejected NULVLESS_TOKEN.', {
      exitCode: ExitCode.Unauthorized,
      hint: 'Create a new token, or unset NULVLESS_TOKEN and run `nulvless login`.',
    });
  }
}

export class ForbiddenError extends CliError {
  constructor(message: string) {
    super(message, {
      exitCode: ExitCode.Unauthorized,
      hint: 'Ask an owner or admin of the organization for access.',
    });
  }
}

export class MissingOptionError extends CliError {
  constructor(what: string, flag: string, variable: string) {
    super(`No ${what} selected.`, { hint: `Pass ${flag} or set ${variable}.` });
  }
}

export class LoginNotConfiguredError extends CliError {
  constructor() {
    super('This build of the CLI has no OAuth client configured.', { hint: 'Set NULVLESS_CLIENT_ID to sign in.' });
  }
}

export class CancelledError extends CliError {
  constructor() {
    super('Cancelled.');
  }
}

export class SignInError extends CliError {
  constructor(message: string) {
    super(message, { hint: 'Run `nulvless login` to try again.' });
  }
}
