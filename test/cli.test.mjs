import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Regression: a duplicate declaration in cli.mjs made every command fail at
// parse time, and the unit tests never noticed because none of them import the
// CLI. A CI run then 'succeeded' at each step in zero seconds. Loading the
// module is the cheapest possible guard against that class of break.
test('the CLI parses and runs', async () => {
  const { stdout } = await run(process.execPath, ['src/cli.mjs']);
  assert.match(stdout, /lobby-to-law/);
  for (const cmd of ['probe', 'fetch:lobbying', 'stats', 'offices', 'resolve', 'timeline']) {
    assert.ok(stdout.includes(cmd), `usage should mention ${cmd}`);
  }
});

test('every command path in the CLI is syntactically reachable', async () => {
  // `node --check` parses without executing: it catches redeclarations and
  // typos inside command branches that a help-text run never enters.
  await run(process.execPath, ['--check', 'src/cli.mjs']);
});
