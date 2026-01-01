# AGENTS.md

Guidance for AI agents working on this repository.

## Commands

```bash
npm install
npm run build        # bundles src/ to dist/index.js with tsup
npm test             # jest; specs in src/**/tests/*.spec.ts
npm run typecheck
npm run lint
node dist/index.js --help
```

Run `npm test`, `npm run typecheck` and `npm run lint` before finishing a change.

## Conventions

- TypeScript, ESM, Node.js 20+. Commands live in `src/commands/`, one file per
  group, and stay thin: parse arguments, call `src/api/resources.ts`, print
  through `Output`.
- Results go to stdout, everything else to stderr. Every command supports
  `--json`; in JSON mode nothing but JSON is written.
- Never prompt when `prompter.interactive` is false. Fail with a `CliError`
  whose hint names the flag or variable to pass.
- Errors are `CliError` subclasses from `src/errors.ts` with a user-facing
  message and a hint. Messages describe what the user tried to do, never
  internal details.
- Write the failing spec first, then the code.
- No comments in code; prefer clearer names.
- The CLI never bundles, downloads or runs the Nulvless edge runtime.
