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
nulvless whoami                                  # account and organizations
nulvless environments list --project shop        # environments of a project
nulvless secrets set STRIPE_SECRET_KEY --function checkout --project shop
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

### CI and automation

Set `NULVLESS_TOKEN` to an access token. It takes precedence over any stored
session, and nothing is prompted when the CLI is not attached to a terminal.

```bash
NULVLESS_TOKEN=… nulvless functions list --org acme --project shop --json
```

## Commands

```text
nulvless login                                  sign in in the browser
nulvless logout                                 remove the stored session
nulvless whoami                                 account and organizations

nulvless environments list                      environments of the project (alias: envs)
nulvless environments create <slug> [--name]    create an environment
nulvless environments delete <slug>             delete an environment

nulvless functions list                         Edge Functions of the project (alias: fn)
nulvless functions deployments <slug>           deployment history of a function
nulvless functions delete <slug>                delete a function

nulvless secrets list --function <slug>         secret names, never values
nulvless secrets set KEY[=VALUE] --function <slug>
nulvless secrets unset KEY --function <slug>

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
| Automatic | the only organization of the account | — |
| Interactive | a list to choose from | a list to choose from |

## Environment variables

| Variable | Purpose |
| --- | --- |
| `NULVLESS_TOKEN` | Access token to use instead of the stored session |
| `NULVLESS_ORG` | Default organization |
| `NULVLESS_PROJECT` | Default project |
| `NO_COLOR` | Disables colors |
| `FORCE_HYPERLINK` | `1` or `0` forces clickable links in the terminal on or off |

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
