# Nulvless CLI

AI-powered CLI to integrate Nulvless into your app, built for AI agents and the
humans who work with them.

[![npm](https://img.shields.io/npm/v/@nulvless/cli.svg)](https://www.npmjs.com/package/@nulvless/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Manage environments, Edge Functions and their secrets, and read the Nulvless
docs as Markdown, from your terminal or from an AI coding agent. Every command
has a JSON mode, predictable exit codes and errors that say how to fix them.

```bash
npx @nulvless/cli login
npx @nulvless/cli functions list --project shop
```

Installed globally, the package adds the `nulvless` command.

## Install

```bash
npm install --global @nulvless/cli
```

Requires Node.js 20 or later. Check the installed version with `nulvless --version`.

## Quickstart

```bash
nulvless login                                   # sign in in the browser
nulvless init --org acme --project shop          # create nulvless/ in your repository
nulvless functions new whoami --template verify-session
nulvless functions deploy                        # create or update every function
nulvless secrets set PROJECT_SECRET_KEY --function whoami
nulvless docs quickstart                         # docs as Markdown
```

Run `nulvless --help` or `nulvless <command> --help` for every option, with examples.

## Use it with AI agents

The CLI is designed to be driven by coding agents such as Claude Code, Cursor,
Codex or Copilot as well as by people.

- **Docs in context.** `nulvless docs` prints the index of every docs page and
  `nulvless docs <path>` prints one page as Markdown, ready to feed an agent.
- **Machine-readable output.** `--json` prints results as JSON on stdout. When a
  command fails, the error is a single JSON line on stderr:
  `{"error":{"message":"…","hint":"…","exitCode":2}}`.
- **Never stuck on a prompt.** Outside a terminal the CLI never asks anything. A
  missing organization or project fails with the flag to pass, and destructive
  commands require `--yes`.
- **Errors that say what to do.** Every error comes with a hint, such as
  ``Run `nulvless login` to sign in.``
- **Token auth.** Set `NULVLESS_TOKEN` and no browser is involved.

Add this to your `AGENTS.md`, `CLAUDE.md` or editor rules so your agent knows the CLI is available:

```markdown
Use the Nulvless CLI (`npx @nulvless/cli`) to work with Nulvless.
Read the docs with `npx @nulvless/cli docs` and `npx @nulvless/cli docs <path>` before
writing integration code. Always pass `--json`, plus `--org` and `--project`.
```

## Workspace

`nulvless init` creates a `nulvless/` folder in your repository. It holds your
Edge Functions as code, so they are reviewed in pull requests and deployed from
the terminal or CI.

```text
nulvless/
├── nulvless.jsonc        organization, project and function settings
├── functions/
│   ├── checkout/         one folder per function; the folder name is the slug
│   │   ├── index.ts
│   │   └── deno.json     optional import map (npm:, jsr:)
│   └── _drafts/          folders starting with _ are skipped by deploy
├── templates/
│   ├── email/
│   │   └── welcome-user/ one folder per template; the folder name is the slug
│   │       ├── template.json   subject per language
│   │       └── en-US.html
│   └── sms/
└── .gitignore            keeps .env.local out of git
```

```jsonc
{
  "$schema": "https://cdn.jsdelivr.net/npm/@nulvless/cli/schema/workspace.schema.json",
  "organization": "acme",
  "project": "shop",
  "functions": {
    "checkout": { "name": "Checkout", "secrets": ["STRIPE_SECRET_KEY"] }
  }
}
```

Inside a workspace, commands use its `organization` and `project`, so
`--org` and `--project` are only needed to act on another one.

`functions deploy` creates the functions that do not exist yet and updates the
others. It never deletes one that is missing from the folder; use
`functions delete` for that. To undo a bad deploy, `functions promote <slug>`
serves one of the previous successful versions again, without rebuilding it;
the current version and the three before it are kept. A function's files must sit next to its
`index.ts`; subfolders are not supported yet.

### Templates

Email and SMS templates live in `nulvless/templates/email/<slug>/` and
`nulvless/templates/sms/<slug>/`, with one file per language (`en-US.html` for
email, `en-US.txt` for SMS). Email subjects go in a `template.json` next to
them. Templates belong to an environment, so
pushing and pulling always name one:

```bash
nulvless templates new welcome-user --template welcome-user   # start from the platform default
nulvless templates push --env staging                          # create or update each language
nulvless templates pull --env main                             # bring console changes into git
```

Using a platform slug such as `welcome-user` replaces the email Nulvless sends
for it. Pushing to `main` asks for confirmation, or `--yes`.

### Examples

[`nulvless/examples`](https://github.com/nulvless/examples) holds ready-made
functions and apps. The CLI reads its catalog on demand, so new examples need no
CLI update.

```bash
nulvless examples                                   # list them
nulvless functions new whoami --template verify-session # one function into the workspace
nulvless create my-app --example auth-nextjs        # a whole new project
nulvless examples --kind template                   # default email and SMS templates
```

## Authentication

```bash
nulvless login
```

The CLI opens the Nulvless sign-in and consent screen in your browser. After you
approve, the browser returns to a one-time local address the CLI listens on
(`127.0.0.1` on a random port), and once the session is stored the browser
lands on a confirmation page in the console. The session never passes through a
third party.

The session is stored in your system keychain: macOS Keychain, Windows
Credential Manager, or the Secret Service (GNOME Keyring, KWallet) on Linux.
Where no keychain is available, it falls back to
`~/.config/nulvless/session.json`, readable only by your user. The access token
is renewed automatically before it expires.

```bash
nulvless whoami    # who is signed in
nulvless logout    # remove the session from this computer
```

### Sudo

Some actions ask you to confirm it is you first: creating or revoking API
keys, rotating signing keys and merging environments. When one does, the CLI
sends a code to your email, phone or authenticator, asks for it, and runs the
action. Sudo then stays active for a few minutes, so the next protected actions
run without asking.

```bash
nulvless sudo                          # confirm now, before a batch of actions
nulvless keys create ci-deploy --type private --env staging
```

Outside a terminal there is nothing to type the code into, so protected actions
fail with a hint: run `nulvless sudo` in a terminal first, then repeat them
within the sudo window. `NULVLESS_TOKEN` cannot be elevated.

### CI and automation

Set `NULVLESS_TOKEN` to an access token. It takes precedence over any stored
session, and nothing is prompted when the CLI is not attached to a terminal.

```bash
NULVLESS_TOKEN=… nulvless functions list --org acme --project shop --json
```

## Commands

Commands that act on one environment take `--env <environment>`, which
defaults to `main` (production). Run `nulvless <command> --help` for every
option.

```text
nulvless login | logout | whoami                sign in, sign out, show the account
nulvless sudo                                   confirm it is you before protected actions
nulvless doctor                                 check your setup and print each fix
nulvless upgrade                                update the CLI to its latest version

nulvless init                                   create a workspace (nulvless/) here
nulvless link                                   link the workspace to a project
nulvless create <dir> --example <name>          new project from an example app
nulvless examples [--kind function|app|template]

nulvless functions new <slug> [--template]      new function in the workspace (alias: fn)
nulvless functions pull [slug...]               write existing functions into the workspace
nulvless functions deploy [slug...]             create or update functions from the workspace
nulvless functions list                         Edge Functions of the project
nulvless functions deployments <slug>           history, with the live version
nulvless functions promote <slug> [version]     serve an earlier kept version again
nulvless functions delete <slug>                delete a function

nulvless secrets list | set | unset --function <slug>
nulvless secrets pull --function <slug> [-o]    write the values to a local env file

nulvless deployments list [--function] [--context] [--status]
nulvless deployments get <id>                   pipeline steps and why it failed

nulvless templates new <slug> [--template]      new email or SMS template in the workspace
nulvless templates push | pull [slug...] --env <env>

nulvless environments list | create | delete    environments of the project (alias: envs)
nulvless environments diff <origin> <destination>
nulvless environments merge <origin> <destination> [--wait]

nulvless users list [--email] [--banned] ...    users of an environment
nulvless users get | create | delete | ban | unban | sign-out
nulvless users sessions | factors <id>
nulvless users remove-factor <id> <factor-id>

nulvless oauth settings [update]                OAuth Server settings
nulvless oauth clients list | get | create | update | delete | rotate-secret

nulvless keys list | create | revoke            API keys
nulvless signing-keys list | create | promote | restore | revoke | delete

nulvless projects list | get | create | health | pause | restore | delete
nulvless domains list | add | remove
nulvless orgs list
nulvless members list | invite | remove

nulvless docs [path]                            the docs as Markdown
```

`secrets set KEY` without a value asks for it without echoing it, so the value
stays out of your shell history. Names starting with `NULVLESS_` or `NVL_` are
reserved by the platform and rejected before any request is sent.

### Global options

| Option | Effect |
| --- | --- |
| `--org <slug>` | Organization to act on |
| `--project <slug>` | Project to act on |
| `--json` | Prints results as JSON on stdout, and errors as JSON on stderr |
| `-y, --yes` | Skips confirmation prompts; required for destructive commands outside a terminal |

### Choosing the organization and project

| Source | Organization | Project |
| --- | --- | --- |
| Flag | `--org <slug>` | `--project <slug>` |
| Environment variable | `NULVLESS_ORG` | `NULVLESS_PROJECT` |
| Workspace | `organization` in `nulvless/nulvless.jsonc` | `project` in `nulvless/nulvless.jsonc` |
| Automatic | the only organization of the account | — |
| Interactive | a list to choose from | a list to choose from |

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NULVLESS_TOKEN` | Access token to use instead of the stored session |
| `NULVLESS_ORG` | Default organization |
| `NULVLESS_PROJECT` | Default project |
| `NULVLESS_EXAMPLES_URL` | Where to read examples from, for testing a fork of `nulvless/examples` |
| `NO_COLOR` | Disables colors |
| `FORCE_HYPERLINK` | `1` or `0` forces clickable links in the terminal on or off |

## Diagnostics and updates

`nulvless doctor` checks Node.js, the CLI version, whether the API answers,
your sign-in, the workspace and access to its project, and prints the command
that fixes each problem. With `--json` an agent can read the same report.

Once a day the CLI checks npm for a newer version and, in a terminal, mentions
it after the command finishes. The check is skipped in CI and with `--json`.

`nulvless upgrade` installs the latest version with the package manager that
installed the CLI: `npm`, `pnpm`, `yarn` or `bun`. A run through `npx` or a CLI
installed as a project dependency is left to you, with the command to use.

## Output and exit codes

Results go to stdout. Progress, confirmations and errors go to stderr, so
`--json` output can be piped safely.

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | The command failed, was cancelled, or a value is missing |
| `2` | Not signed in, session expired, or not allowed |
| `130` | Interrupted with Ctrl+C |

## Roadmap

- **Device Flow sign-in ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)).**
  Today `nulvless login` uses the authorization code flow with PKCE and a
  loopback redirect, which needs a browser on the same machine. Device Flow
  shows a short code in the terminal that you approve from any browser, on any
  device, so sign-in also works over SSH, in containers and on machines without
  a browser. It needs Device Authorization support in the Nulvless OAuth Server
  first; the CLI would then offer it as `nulvless login --device`, and could
  fall back to it automatically when no browser can be opened.

## Contributing

Issues and pull requests are welcome. To work on the CLI:

```bash
git clone https://github.com/nulvless/cli.git
cd cli
npm install
npm run build && node dist/index.js --help
npm test
npm run typecheck
npm run lint
```

`npm run dev` rebuilds on every change. Specs live next to the code in
`src/**/tests/*.spec.ts`.

```text
src/
  index.ts         entry point: runs the program, maps errors to exit codes
  program.ts       commander setup and global options
  context.ts       wiring: platform, credentials, API client, prompts, output
  commands/        one file per command group: parse, call, print
  api/             HTTP client for the Nulvless API and its resources
  auth/            browser sign-in: PKCE, loopback callback, token exchange
  credentials/     keychain or file storage, session renewal
  ui/              colors, spinner, prompts, help and error rendering
```

To run against another Nulvless environment, set `NULVLESS_API_URL`,
`NULVLESS_ISSUER`, `NULVLESS_PUBLISHABLE_KEY`, `NULVLESS_CLIENT_ID`,
`NULVLESS_CONSOLE_URL` and `NULVLESS_DOCS_URL`.

## Security

Please do not open public issues for vulnerabilities. Report them privately
through [GitHub security advisories](https://github.com/nulvless/cli/security/advisories/new).

## License

[MIT](LICENSE)
