import pc from 'picocolors';
import { createApi, type Api } from './api/http';
import type { Scope } from './api/resources';
import { refreshWith } from './auth/login';
import { elevateSession, sudoClientFor } from './auth/sudo';
import { defaultCredentialStore, type CredentialStore } from './credentials/credential-store';
import { accessToken } from './credentials/session';
import type { FetchText } from './examples';
import { CancelledError, CliError, SessionExpiredError, TokenRejectedError } from './errors';
import { createOutput, type Output } from './output';
import { platformFrom, type Platform } from './platform';
import { resolveOrganization, resolveScope } from './scope';
import { isInteractive, terminalPrompter, type Prompter } from './ui/prompter';
import { supportsHyperlinks } from './ui/style';
import { findWorkspace, readWorkspaceConfig } from './workspace';

export interface GlobalFlags {
  org?: string;
  project?: string;
  json?: boolean;
  yes?: boolean;
}

export interface Context {
  env: NodeJS.ProcessEnv;
  cwd: string;
  fetch: FetchText;
  platform: Platform;
  output: Output;
  prompter: Prompter;
  store: CredentialStore;
  api: Api;
  token(): Promise<string>;
  elevate(): Promise<{ expiresIn: number }>;
  scope(): Promise<Scope>;
  organization(): Promise<string>;
  confirm(message: string): Promise<void>;
}

export type ContextFactory = (flags: GlobalFlags) => Promise<Context>;

export function sudoMinutes(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

export async function confirmAction(flags: GlobalFlags, prompter: Prompter, message: string) {
  if (flags.yes) return;
  if (!prompter.interactive) throw new CliError(message, { hint: 'Pass --yes to confirm without a prompt.' });
  if (!(await prompter.confirm(message))) throw new CancelledError();
}

export const createContext: ContextFactory = async (flags) => {
  const env = process.env;
  const cwd = process.cwd();
  const platform = platformFrom(env);
  const store = await defaultCredentialStore(env);
  const prompter = terminalPrompter(isInteractive(env));
  const token = () => accessToken({ env, store, refresh: refreshWith(platform) });
  const output = createOutput(Boolean(flags.json), process, {
    decorated: !flags.json && Boolean(process.stderr.isTTY) && !env.CI,
    hyperlinks: supportsHyperlinks(env),
  });

  const confirmIdentity = async () => {
    if (env.NULVLESS_TOKEN) {
      throw new CliError('Sudo cannot be confirmed with NULVLESS_TOKEN.', {
        hint: 'Run the command signed in with `nulvless login`, or unset NULVLESS_TOKEN.',
      });
    }
    const client = sudoClientFor(platform, await token());
    try {
      return await elevateSession({ client, store, prompter });
    } finally {
      client.dispose?.();
    }
  };

  const elevateForRequest = async () => {
    output.info('This action needs you to confirm it is you.');
    const { expiresIn } = await confirmIdentity();
    output.success(`Confirmed. Sudo stays active for ${sudoMinutes(expiresIn)}.`);
  };

  const workspaceLink = async () => {
    const workspace = await findWorkspace(cwd);
    return workspace ? readWorkspaceConfig(workspace) : {};
  };

  const api = createApi({
    baseUrl: platform.apiUrl,
    token,
    unauthorized: () => (env.NULVLESS_TOKEN ? new TokenRejectedError() : new SessionExpiredError()),
    ...(prompter.interactive && !env.NULVLESS_TOKEN ? { elevate: elevateForRequest } : {}),
  });

  return {
    env,
    cwd,
    fetch: (url) => fetch(url),
    platform,
    output,
    prompter,
    store,
    api,
    token,
    elevate: confirmIdentity,
    organization: async () => resolveOrganization({ flags, env, linked: await workspaceLink(), api, prompter }),
    scope: async () => {
      const scope = await resolveScope({ flags, env, linked: await workspaceLink(), api, prompter });
      output.step(`Project ${pc.bold(scope.project)} ${pc.dim(`in ${scope.organization}`)}`);
      return scope;
    },
    confirm: (message) => confirmAction(flags, prompter, message),
  };
};
