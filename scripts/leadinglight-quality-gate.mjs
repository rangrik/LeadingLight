// Local quality gates for the LeadingLight fork; no organization services required.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function run(command, args, extraEnv = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, CARGO_BUILD_JOBS: '2', VITEST_MAX_WORKERS: '2', ...extraEnv },
  })
}

function changedFiles(stage) {
  if (stage === 'commit') return git(['diff', '--cached', '--name-only']).split('\n')
  const base = git(['rev-parse', '--verify', 'upstream/main'])
  return git(['diff', '--name-only', base, 'HEAD']).split('\n')
}

const stage = process.argv[2]
if (!['commit', 'push'].includes(stage)) throw new Error('Expected commit or push')
const files = changedFiles(stage).filter((file) => file && existsSync(file))
const lintable = files.filter((file) => /\.(?:ts|tsx|js|jsx|mjs)$/.test(file))
if (lintable.length) run('pnpm', ['exec', 'eslint', '--max-warnings=0', ...lintable])
if (stage === 'push' && files.some((file) => /^(src\/|src-tauri\/|package.json|pnpm-lock.yaml)/.test(file))) {
  run('pnpm', ['build'])
  const tests = [...new Set([
    'src/leadinglight', 'src/hooks/useEditorSave.test.ts', 'src/hooks/useEditorSaveWithLinks.test.ts',
    ...files.filter((file) => /\.(?:test|spec)\.[jt]sx?$/.test(file)),
    ...files.filter((file) => /^src\/.*\.[jt]sx?$/.test(file)).flatMap((file) => {
      const stem = basename(file, extname(file))
      return readdirSync(dirname(file))
        .filter((name) => name.startsWith(`${stem}.`) && /\.(?:test|spec)\.[jt]sx?$/.test(name))
        .map((name) => join(dirname(file), name))
    }),
  ])]
  run('pnpm', ['exec', 'vitest', 'run', ...tests])
  if (files.some((file) => /^src-tauri\/(?:src\/.*\.rs|Cargo\.(?:toml|lock))$/.test(file))) {
    run('cargo', ['check', '--locked', '--manifest-path', 'src-tauri/Cargo.toml'])
    for (const filter of ['leadinglight', 'shutdown_save', 'settings::', 'app_config::', 'vault_list::', 'vault::cache::tests::paths_and_io']) {
      run('cargo', ['test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', filter])
    }
  }
}
console.log(`LeadingLight ${stage} checks passed.`)
