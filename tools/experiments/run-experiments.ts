#!/usr/bin/env tsx
// CLI runner for the bas-sandbox experiment catalog. Designed for
// autonomous-play loops: any agent (or a CI step) can run this,
// parse the JSON output, and react to failures without needing to
// touch the browser.
//
// Usage:
//   pnpm exp                # run all, print markdown to stdout
//   pnpm exp --json         # JSON instead of markdown
//   pnpm exp --tag mstp     # filter by tag
//   pnpm exp --id <id>      # run one experiment by id
//   pnpm exp --out file.md  # write report to file
//
// Exit code = number of failed experiments (0 = all pass), so CI
// and shell loops can branch on success.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EXPERIMENT_CATALOG,
  findExperiment,
  experimentsByTag,
  runCatalog,
  formatCatalogMarkdown,
  type ExperimentSpec,
} from '../../packages/core/src/experiments/index.js';

interface CliArgs {
  json: boolean;
  markdown: boolean;
  tag: string | null;
  id: string | null;
  out: string | null;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const out: CliArgs = {
    json: false,
    markdown: false,
    tag: null,
    id: null,
    out: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--md' || a === '--markdown') out.markdown = true;
    else if (a === '--tag') out.tag = argv[++i] ?? null;
    else if (a === '--id') out.id = argv[++i] ?? null;
    else if (a === '--out') out.out = argv[++i] ?? null;
    else if (a === '-h' || a === '--help') out.help = true;
  }
  // Default format = markdown unless --json is requested.
  if (!out.json && !out.markdown) out.markdown = true;
  return out;
}

function help(): string {
  return [
    'run-experiments — bas-sandbox autonomous experiment runner',
    '',
    'Usage: pnpm exp [options]',
    '',
    'Options:',
    '  --json           Emit JSON instead of markdown',
    '  --md|--markdown  Emit markdown (default)',
    '  --tag <tag>      Run only experiments with this tag',
    '  --id <id>        Run a single experiment by id',
    '  --out <path>     Write report to file (still prints to stdout)',
    '  -h, --help       Show this message',
    '',
    'Exit code = number of failed experiments.',
  ].join('\n');
}

function selectSpecs(args: CliArgs): readonly ExperimentSpec[] {
  if (args.id) {
    const one = findExperiment(args.id);
    if (!one) {
      process.stderr.write(`No experiment with id "${args.id}".\n`);
      process.exit(2);
    }
    return [one];
  }
  if (args.tag) {
    const subset = experimentsByTag(args.tag);
    if (subset.length === 0) {
      process.stderr.write(`No experiments tagged "${args.tag}".\n`);
      process.exit(2);
    }
    return subset;
  }
  return EXPERIMENT_CATALOG;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(help() + '\n');
    process.exit(0);
  }

  const specs = selectSpecs(args);
  const run = runCatalog(specs);

  let report: string;
  if (args.json) {
    report = JSON.stringify(run, null, 2);
  } else {
    report = formatCatalogMarkdown(run);
  }
  process.stdout.write(report + '\n');

  if (args.out) {
    const p = resolve(process.cwd(), args.out);
    writeFileSync(p, report, 'utf8');
    process.stderr.write(`\nReport written to ${p}\n`);
  }

  // Stderr summary line for humans regardless of format.
  process.stderr.write(
    `\n${run.summary.passed}/${run.summary.total} passed` +
      ` (${run.summary.failed} failed, ${run.summary.durationMs.toFixed(1)}ms)\n`,
  );

  process.exit(run.summary.failed);
}

main();
