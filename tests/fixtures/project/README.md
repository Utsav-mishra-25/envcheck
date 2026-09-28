# envcheck fixture project

Used by `tests/cli.test.ts`. Every supported syntax appears at least once, and each
finding below is deliberate. If you change a file here, update this table and the test.

This Markdown file is itself a decoy: `.md` is not scanned, so process.env.FROM_MARKDOWN
must never be reported.

## Syntax coverage

| File | Syntaxes |
| --- | --- |
| `src/server.ts` | `process.env.X`, `process.env["X"]`, `process.env['X']`, `` process.env[`X`] ``, `process.env?.X` |
| `src/App.tsx` | `import.meta.env.X`, `import.meta.env["X"]` |
| `src/legacy.js` | `process.env.X`, dynamic `process.env[name]` (not reported) |
| `src/Widget.jsx` | `import.meta.env?.X` |
| `worker/tasks.py` | `os.environ["X"]`, `os.environ['X']`, `os.getenv("X")`, `os.getenv('X', default)`, `os.environ.get("X")` |
| `cmd/api/main.go` | `os.Getenv("X")`, `` os.Getenv(`X`) ``, `os.LookupEnv("X")` |
| `lib/mailer.rb` | `ENV["X"]`, `ENV['X']`, `ENV.fetch("X")`, `ENV.fetch('X', default)` |
| `.github/workflows/deploy.yml` | workflow/job/step `env:`, `${{ secrets.X }}`, `if: secrets.X`, `secrets.GITHUB_TOKEN` (built in) |

## Decoys that must never be scanned

`tests/cli.test.ts` runs against a temp copy of this directory and first writes decoy files
into it (see `DECOYS` there), so none of them are committed:

| Path | Why it must be skipped |
| --- | --- |
| `node_modules/`, `dist/`, `venv/`, `.venv/`, `.git/` | always skipped |
| `generated/client.ts` | this fixture's `.gitignore` (`generated/`) |
| `src/drop.local.ts` | this fixture's `.gitignore` (`*.local.ts`) |
| `README.md` (this file) | unsupported extension |

`src/keep.local.ts` matches `*.local.ts` but is re-included by `!keep.local.ts`, so its
`KEPT_BY_NEGATION` reference **is** reported.

## Expected results

Plain `envcheck` (22 findings):

- **MISSING (15):** AWS_REGION, CELERY_BROKER_URL, DEPLOY_REGION, GO_SERVICE_TOKEN,
  KEPT_BY_NEGATION, LOG_LEVEL, MAILER_FROM, MAILER_REPLY_TO, NODE_OPTIONS, SMTP_HOST,
  SMTP_PASSWORD, VITE_ANALYTICS_ID, VITE_FEATURE_FLAG, WORKER_CONCURRENCY, WORKER_DEBUG
- **UNUSED (4):** LEGACY_TOKEN, LOCAL_DEBUG, OLD_FEATURE_FLAG, SLACK_WEBHOOK_URL
- **MISMATCH (3):** LEGACY_TOKEN (only in `.env`), OLD_FEATURE_FLAG and SENTRY_DSN (only in `.env.example`)

Flag effects:

- `--env config/extra.env` defines SMTP_HOST, SMTP_PASSWORD, MAILER_FROM.
- `--ci` defines DEPLOY_REGION and GO_SERVICE_TOKEN (workflow `env:`), adds MISSING
  SERVICE_TOKEN and DEPLOY_KEY (undocumented secrets), and marks SLACK_WEBHOOK_URL as used.
- `--ignore 'NODE_*'` drops NODE_OPTIONS; `--ignore 'VITE_*'` drops the two VITE_ names.
