import pc from 'picocolors';
import { createApi, type Api } from './api/http';
import type { Scope } from './api/resources';
import { refreshWith } from './auth/login';
import { defaultCredentialStore, type CredentialStore } from './credentials/credential-store';
import { accessToken } from './credentials/session';
import { CancelledError, CliError, SessionExpiredError, TokenRejectedError } from './errors';
import { createOutput, type Output } from './output';
import { platformFrom, type Platform } from './platform';
import { resolveScope } from './scope';
import { isInteractive, terminalPrompter, type Prompter } from './ui/prompter';
import { supportsHyperlinks } from './ui/style';

export interface GlobalFlags {
  org?: string;
  project?: string;
  json?: boolean;
  yes?: boolean;
}

export interface Context {
  env: NodeJS.ProcessEnv;
  platform: Platform;
  output: Output;
  prompter: Prompter;
  store: CredentialStore;
  api: Api;
  token(): Promise<string>;
  scope(): Promise<Scope>;
  confirm(message: string): Promise<void>;
}

export type ContextFactory = (flags: GlobalFlags) => Promise<Context>;

export async function confirmAction(flags: GlobalFlags, prompter: Prompter, message: string) {
  if (flags.yes) return;
  if (!prompter.interactive) throw new CliError(message, { hint: 'Pass --yes to confirm without a prompt.' });
  if (!(await prompter.confirm(message))) throw new CancelledError();
}

export const createContext: ContextFactory = async (flags) => {
  const env = process.env;
  const platform = platformFrom(env);
  const store = await defaultCredentialStore(env);
  const prompter = terminalPrompter(isInteractive(env));
  const token = () => accessToken({ env, store, refresh: refreshWith(platform) });
  const api = createApi({
    baseUrl: platform.apiUrl,
    token,
    unauthorized: () => (env.NULVLESS_TOKEN ? new TokenRejectedError() : new SessionExpiredError()),
  });

  const output = createOutput(Boolean(flags.json), process, {
    decorated: !flags.json && Boolean(process.stderr.isTTY) && !env.CI,
    hyperlinks: supportsHyperlinks(env),
  });

  return {
    env,
    platform,
    output,
    prompter,
    store,
    api,
    token,
    scope: async () => {
      const scope = await resolveScope({ flags, env, api, prompter });
      output.step(`Project ${pc.bold(scope.project)} ${pc.dim(`in ${scope.organization}`)}`);
      return scope;
    },
    confirm: (message) => confirmAction(flags, prompter, message),
  };
};
