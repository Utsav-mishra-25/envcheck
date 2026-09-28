import { createColors } from 'picocolors';
import type { AuditReport } from './audit.js';

export function countFindings(report: AuditReport): number {
  return report.missing.length + report.unused.length + report.mismatch.length;
}

/** Stable, machine-readable shape. Treat changes to it as breaking. */
export function toJson(report: AuditReport): object {
  return {
    summary: {
      missing: report.missing.length,
      unused: report.unused.length,
      mismatch: report.mismatch.length,
      total: countFindings(report),
    },
    stats: report.stats,
    missing: report.missing.map(({ name, references }) => ({
      name,
      references: references.map(({ file, line, column, syntax }) => ({ file, line, column, syntax })),
    })),
    unused: report.unused,
    mismatch: report.mismatch,
    mismatchSkipped: report.mismatchSkipped,
    warnings: report.warnings,
  };
}

export function renderJson(report: AuditReport): string {
  return `${JSON.stringify(toJson(report), null, 2)}\n`;
}

/** Colored, grouped output for terminals. With `color: false` the text is plain. */
export function renderHuman(report: AuditReport, options: { color: boolean }): string {
  const c = createColors(options.color);
  const out: string[] = [];
  const { stats } = report;

  const sources = [`env files: ${stats.envFiles.length > 0 ? stats.envFiles.join(', ') : 'none found'}`];
  if (stats.workflows.length > 0) sources.push(`workflows: ${stats.workflows.join(', ')}`);
  out.push(
    `${c.bold('envcheck')} ${c.dim('·')} ${plural(stats.filesScanned, 'file')} scanned ${c.dim('·')} ` +
      `${plural(stats.references, 'reference')} to ${plural(stats.variables, 'variable')}`,
    c.dim(sources.join(' · ')),
    '',
  );

  // MISSING: one block per variable, one line per reference.
  out.push(header(c.red, 'MISSING', report.missing.length, 'referenced in code, not defined in any env file'));
  if (report.missing.length === 0) out.push(none());
  for (const { name, references } of report.missing) {
    out.push(`  ${c.bold(name)}`);
    // Several references on one line collapse to one entry; JSON keeps each with its column.
    for (const [location, count] of countByLine(references)) {
      out.push(`    ${c.cyan(location)}${count > 1 ? c.dim(` ×${count}`) : ''}`);
    }
  }
  out.push('');

  // UNUSED: one line per variable, listing where it is defined.
  out.push(header(c.yellow, 'UNUSED', report.unused.length, 'defined in env files, never referenced'));
  if (report.unused.length === 0) out.push(none());
  const unusedWidth = columnWidth(report.unused.map((u) => u.name));
  for (const { name, definitions } of report.unused) {
    const where = definitions.map((d) => `${d.file}:${d.line}`).join(', ');
    out.push(`  ${c.bold(name.padEnd(unusedWidth))}  ${c.cyan(where)}`);
  }
  out.push('');

  // MISMATCH: one line per variable, with direction.
  out.push(header(c.magenta, 'MISMATCH', report.mismatch.length, '.env and .env.example disagree'));
  if (report.mismatchSkipped) out.push(`  ${c.dim(`skipped: ${report.mismatchSkipped}`)}`);
  else if (report.mismatch.length === 0) out.push(none());
  const mismatchWidth = columnWidth(report.mismatch.map((m) => m.name));
  for (const { name, presentIn, missingFrom, line } of report.mismatch) {
    out.push(
      `  ${c.bold(name.padEnd(mismatchWidth))}  in ${c.cyan(`${presentIn}:${line}`)}, missing from ${c.cyan(missingFrom)}`,
    );
  }
  out.push('');

  const total = countFindings(report);
  if (total === 0) {
    out.push(c.green(c.bold('✔ No issues found')));
  } else {
    const parts = `${report.missing.length} missing · ${report.unused.length} unused · ${report.mismatch.length} mismatch`;
    out.push(`${c.red(c.bold(`✖ ${plural(total, 'finding')}`))} ${c.dim(`(${parts})`)}`);
  }

  return `${out.join('\n')}\n`;

  function header(paint: (s: string) => string, title: string, count: number, hint: string): string {
    return `${paint(c.bold(`${title} (${count})`))} ${c.dim(hint)}`;
  }

  function none(): string {
    return `  ${c.dim('none')}`;
  }
}

/** Plain-text warning lines for stderr. */
export function renderWarnings(report: AuditReport, options: { color: boolean }): string {
  if (report.warnings.length === 0) return '';
  const c = createColors(options.color);
  return report.warnings
    .map((w) => `${c.yellow('warning')} ${w.line ? `${w.file}:${w.line}` : w.file}: ${w.message}\n`)
    .join('');
}

function countByLine(references: ReadonlyArray<{ file: string; line: number }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { file, line } of references) {
    const key = `${file}:${line}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Pad names to align the second column, but don't let one long name push everything right. */
function columnWidth(names: string[]): number {
  return Math.min(32, Math.max(0, ...names.map((n) => n.length)));
}
