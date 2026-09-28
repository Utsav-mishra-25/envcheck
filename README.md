# envcheck

Audit environment variable usage in a project. `envcheck` finds env vars your code reads but
no env file defines, env file entries nothing reads, and drift between `.env` and `.env.example`.

- Scans **TypeScript, JavaScript, Python, Go and Ruby** (`.ts .tsx .js .jsx .py .go .rb`)
- Compares against **`.env`, `.env.example`, `.env.local`** and any file you pass with `--env`
- Optionally reads **GitHub Actions workflows** (`env:` blocks and `secrets.X`) with `--ci`
- Respects **`.gitignore`** and skips `node_modules`, `dist`, `.git`, `venv`, `.venv`
- Colored, grouped output for humans; **`--json`** for scripts; **`--strict`** for CI gates

## Install

Requires Node.js 20 or newer. The package is not published to npm yet; install it from source:

```sh
git clone https://github.com/Utsav-mishra-25/envcheck.git
cd envcheck
npm ci
npm run build
npm link            # puts `envcheck` on your PATH
```

Then, in any project:

```sh
cd path/to/your/project
envcheck            # or: npx envcheck
```

To remove it again: `npm unlink -g envcheck`.

> **Note:** the npm registry already has an unrelated package called `envcheck`. `npx envcheck`
> runs this tool only when it is linked or installed locally; otherwise npx would download that
> other package.


## Usage

```sh
envcheck                                   # scan the current directory
envcheck --strict                          # exit 1 if anything is found (CI gate)
envcheck --env config/prod.env --env .env.test
envcheck --ci                              # include .github/workflows
envcheck --ignore 'NODE_*' --ignore CI     # skip names matching globs
envcheck --json | jq '.summary'            # machine-readable output
```

### Example

This is the real output of running `envcheck` in this repository:

```text
$ envcheck
envcheck · 30 files scanned · 37 references to 35 variables
env files: none found

MISSING (35) referenced but not defined in any env file
  A
    tests/scanner.test.ts:55
  API_KEY
    tests/fixtures/project/src/server.ts:3
    tests/scanner.test.ts:26
  API_URL
    tests/cli.test.ts:237
  AWS_REGION
    tests/fixtures/project/src/server.ts:6
  B
    tests/scanner.test.ts:55
  CELERY_BROKER_URL
    tests/fixtures/project/worker/tasks.py:5
  DATABASE_URL
    tests/fixtures/project/cmd/api/main.go:10
    tests/fixtures/project/src/server.ts:2
  DEPLOY_REGION
    tests/fixtures/project/cmd/api/main.go:12
  DOUBLE
    tests/scanner.test.ts:33
  FROM_JSX
    tests/scanner.test.ts:131
  FROM_MARKDOWN
    tests/scanner.test.ts:133
  FROM_NODE_MODULES
    tests/scanner.test.ts:134
  FROM_TS
    tests/scanner.test.ts:130
  GO_SERVICE_TOKEN
    tests/fixtures/project/cmd/api/main.go:11
  KEPT_BY_NEGATION
    tests/fixtures/project/src/keep.local.ts:2
  LOG_LEVEL
    tests/fixtures/project/src/server.ts:5
  MAILER_FROM
    tests/fixtures/project/lib/mailer.rb:5
  MAILER_REPLY_TO
    tests/fixtures/project/lib/mailer.rb:6
  NODE_ENV
    tests/fixtures/project/src/server.ts:7
  NODE_OPTIONS
    tests/fixtures/project/src/legacy.js:6
  OPT
    tests/scanner.test.ts:33
  PORT
    tests/fixtures/project/src/server.ts:4
  REDIS_URL
    tests/fixtures/project/worker/tasks.py:4
  SENTRY_DSN
    tests/fixtures/project/worker/tasks.py:6
  SESSION_SECRET
    tests/fixtures/project/src/legacy.js:5
  SINGLE
    tests/scanner.test.ts:33
  SMTP_HOST
    tests/fixtures/project/lib/mailer.rb:3
  SMTP_PASSWORD
    tests/fixtures/project/lib/mailer.rb:4
  SPACED
    tests/scanner.test.ts:33
  VITE_ANALYTICS_ID
    tests/fixtures/project/src/Widget.jsx:2
  VITE_API_URL
    tests/fixtures/project/src/App.tsx:3
  VITE_FEATURE_FLAG
    tests/fixtures/project/src/App.tsx:4
  VITE_URL
    tests/scanner.test.ts:38
  WORKER_CONCURRENCY
    tests/fixtures/project/worker/tasks.py:7
  WORKER_DEBUG
    tests/fixtures/project/worker/tasks.py:8

UNUSED (0) defined in env files, never referenced
  none

MISMATCH (0) .env and .env.example disagree
  skipped: .env and .env.example not found

✖ 35 findings (35 missing · 0 unused · 0 mismatch)
```

This repository has no env files of its own, so every reference counts as MISSING and
MISMATCH is skipped. The references come from the scanner's unit tests (string inputs such
as `process.env["DOUBLE"]`) and from the fixture project in `tests/fixtures/project`, whose
own `.env` files are not at the scan root. Note what is *not* listed: the fixture's
decoys in `node_modules/`, `dist/`, `venv/` and gitignored paths.

Run inside that fixture with every flag, the report looks like this (tail shown):

```text
$ cd tests/fixtures/project
$ envcheck --ci --env config/extra.env --ignore 'NODE_*' --strict
...
MISMATCH (3) .env and .env.example disagree
  LEGACY_TOKEN      in .env:7, missing from .env.example
  OLD_FEATURE_FLAG  in .env.example:7, missing from .env
  SENTRY_DSN        in .env.example:6, missing from .env

✖ 17 findings (11 missing · 3 unused · 3 mismatch)
$ echo $?
1
```

JSON output (same fixture, default flags):

```sh
$ envcheck --json | jq '.summary'
{
  "missing": 15,
  "unused": 4,
  "mismatch": 3,
  "total": 22
}
$ envcheck --json | jq -c '.missing[] | select(.name=="WORKER_DEBUG")'
{"name":"WORKER_DEBUG","references":[{"file":"worker/tasks.py","line":8,"column":9,"syntax":"os.environ"}]}
```

## Report sections

| Section | Meaning |
| --- | --- |
| **MISSING** | Referenced in code (or, with `--ci`, as a workflow secret) but not defined in any env file. Each reference is listed as `file:line`. |
| **UNUSED** | Defined in an env file but never referenced. Lists `file:line` of each definition. |
| **MISMATCH** | In `.env` but not `.env.example`, or the reverse. Only checked when both files exist. |

## Flags

| Flag | Description |
| --- | --- |
| `--json` | Print a JSON report instead of the human one (no colors, warnings included in the document). |
| `--strict` | Exit with code `1` when there is at least one finding. Without it, findings still exit `0`. |
| `--ignore <pattern>` | Skip variables whose name matches a glob (`*` = any run of characters, `?` = one character, case-sensitive). Repeatable. Applies to every section. Example: `--ignore 'NODE_*'`. |
| `--env <path>` | Also read this env file (relative to the current directory). Repeatable. The file must exist. |
| `--ci` | Read `.github/workflows/*.yml`: `env:` keys count as definitions, `secrets.X` counts as a reference. |
| `--no-color` | Disable colors. `NO_COLOR=1` also works. Colors are off when output is piped, unless `CI` or `FORCE_COLOR` is set. |
| `-v, --version` | Print the version. |
| `-h, --help` | Show help. |

Exit codes: `0` success (with or without findings), `1` findings with `--strict`, `2` usage
error (unknown flag, unexpected argument, `--env` file not found) or crash.

## What it detects

| Language | Extensions | Syntax |
| --- | --- | --- |
| JS / TS | `.ts` `.tsx` `.js` `.jsx` | `process.env.X`, `process.env["X"]` / `['X']` / `` [`X`] ``, `process.env?.X`, `import.meta.env.X`, `import.meta.env["X"]` |
| Python | `.py` | `os.environ["X"]`, `os.environ.get("X")`, `os.getenv("X")`, with either quote style |
| Go | `.go` | `os.Getenv("X")`, `` os.Getenv(`X`) ``, `os.LookupEnv("X")` |
| Ruby | `.rb` | `ENV["X"]`, `ENV['X']`, `ENV.fetch("X")` |
| GitHub Actions (`--ci`) | `.github/workflows/*.yml` | `env:` keys at workflow/job/step level; `secrets.X` inside `${{ }}` and `if:` |

Dynamic access such as `process.env[name]` is intentionally ignored: there is no name to check.

### Using it in CI

Add `envcheck --strict` (plus `--ci` and any `--ignore` / `--env` you need) as a pipeline step
once envcheck is installed on the runner. Because the npm name is taken (see the note under
Install), don't rely on `npx envcheck` resolving to this tool in CI.

## How it works

1. **Walk.** Starting at the current directory, envcheck lists files with a supported extension.
   It skips `node_modules`, `dist`, `.git`, `venv` and `.venv` at any depth, never follows
   symlinks, and applies every `.gitignore` it finds (nested files, negation and `**`
   included) with a small built-in matcher.
2. **Scan.** Each file is matched line by line against regexes for its language. Every
   match becomes a reference with a name, file, line, column and the syntax that matched.
3. **Load definitions.** `.env`, `.env.example`, `.env.local` and `--env` files are parsed
   with a dotenv-compatible parser (`export`, quotes, multi-line values, comments). With `--ci`,
   workflow files are read line by line to collect `env:` keys and `secrets.X` references.
4. **Compare.** A pure function computes MISSING, UNUSED and MISMATCH, applies `--ignore`, and
   sorts everything so the output is deterministic.
5. **Report.** The result is rendered as grouped colored text or JSON; the exit code follows `--strict`.

The scanner is regex-based, so a reference inside a comment or a string is still reported,
and aliased access (`const { X } = process.env`) is missed. See
[docs/INSIGHTS.md](docs/INSIGHTS.md) for the full list of trade-offs, design notes and
extension recipes.

## Development

```sh
npm ci
npm run typecheck
npm test            # unit tests + integration tests against tests/fixtures/project
npm run build
```

See [CLAUDE.md](CLAUDE.md) for the project layout and conventions, and
[docs/INSIGHTS.md](docs/INSIGHTS.md) for architecture and debugging tips.
