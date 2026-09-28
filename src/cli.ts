import { Command, CommanderError } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { audit, UsageError } from './audit.js';
import { countFindings, renderHuman, renderJson, renderWarnings } from './report.js';

export interface CliIo {
  /** Directory to scan. */
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Whether the terminal supports color. `--no-color` can still turn it off. */
  color: boolean;
}

interface CliOptions {
  json?: boolean;
  strict?: boolean;
  ignore?: string[];
  env?: string[];
  ci?: boolean;
  color: boolean;
}

/** Exit codes: 0 = ok (or findings without --strict), 1 = findings with --strict, 2 = usage error. */
export const EXIT = { ok: 0, findings: 1, usage: 2 } as const;

/** Run the CLI. `argv` is in `process.argv` form (node path and script path first). */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  const program = createProgram(io);

  try {
    program.parse([...argv]);
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT.ok : EXIT.usage;
    throw error;
  }

  const options = program.opts<CliOptions>();

  let report;
  try {
    report = await audit({ root: io.cwd, envPaths: options.env, ci: options.ci, ignore: options.ignore });
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`envcheck: error: ${error.message}\n`);
      return EXIT.usage;
    }
    throw error;
  }

  if (options.json) {
    io.stdout(renderJson(report));
  } else {
    const color = io.color && options.color;
    io.stdout(renderHuman(report, { color }));
    io.stderr(renderWarnings(report, { color }));
  }

  return options.strict && countFindings(report) > 0 ? EXIT.findings : EXIT.ok;
}

function createProgram(io: CliIo): Command {
  return new Command()
    .name('envcheck')
    .description(
      'Audit environment variable usage: report variables referenced in code but not defined (MISSING), ' +
        'defined but never referenced (UNUSED), and out of sync between .env and .env.example (MISMATCH).',
    )
    .version(pkg.version, '-v, --version')
    .option('--json', 'print machine-readable JSON instead of the human report')
    .option('--strict', 'exit with code 1 when there is any finding')
    .option('--ignore <pattern>', 'skip variables matching a glob, e.g. NODE_* (repeatable)', collect)
    .option('--env <path>', 'also read this env file (repeatable)', collect)
    .option('--ci', 'include GitHub Actions workflows: env: keys and secrets.X references')
    .option('--no-color', 'disable colored output')
    .helpOption('-h, --help', 'show help')
    .allowExcessArguments(false)
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });
}

/** Accumulate a repeatable option. No default is registered so help doesn't print `(default: [])`. */
function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}
