#!/usr/bin/env node
import pc from 'picocolors';
import { EXIT, run } from './cli.js';

run(process.argv, {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  color: pc.isColorSupported,
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`envcheck: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = EXIT.usage;
  },
);
