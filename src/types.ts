/** The access pattern a reference was found with. Kept in JSON output to aid debugging. */
export type Syntax =
  | 'process.env'
  | 'import.meta.env'
  | 'os.environ'
  | 'os.getenv'
  | 'os.Getenv'
  | 'os.LookupEnv'
  | 'ENV'
  | 'secrets';

/** A place in a file. `file` is always a POSIX-style path relative to the scan root. */
export interface Location {
  file: string;
  /** 1-based. */
  line: number;
  /** 1-based, points at the start of the access expression (e.g. the `p` of `process.env`). */
  column: number;
}

/** A single use of an env var in code (or, with --ci, a `secrets.X` use in a workflow). */
export interface Reference extends Location {
  name: string;
  syntax: Syntax;
}

/** Where a variable is defined. `kind` separates env files from CI workflow `env:` blocks. */
export interface Definition {
  name: string;
  file: string;
  line: number;
  kind: 'envfile' | 'ci';
}

/** Something that did not stop the run but the user should know about (e.g. an unparsable line). */
export interface Warning {
  file: string;
  line?: number;
  message: string;
}
