// Image builds only (apps/{api,worker}/Dockerfile). Node refuses to strip types under
// `node_modules`, and `pnpm deploy` copies workspace packages there, so every `packages/*`
// package is compiled to `dist/` and its `exports` are pointed at the JS. Test-only subpaths
// (`./testing*`) are dropped from `exports`: test doubles never ship in an image.
// Never run this in a checkout: it rewrites the packages' package.json files.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

for (const name of readdirSync(join(root, 'packages'))) {
  const dir = join(root, 'packages', name);
  const manifestPath = join(dir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const tsconfigPath = join(dir, 'tsconfig.image.json');
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: { rootDir: 'src', outDir: 'dist', noCheck: true, declaration: false },
      include: ['src'],
      exclude: ['src/**/*.test.ts', 'src/testing'],
    }),
  );
  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  execFileSync(process.execPath, [tsc, '-p', tsconfigPath], { stdio: 'inherit' });
  rmSync(tsconfigPath);

  manifest.exports = Object.fromEntries(
    Object.entries(manifest.exports)
      .filter(([subpath]) => !subpath.startsWith('./testing'))
      .map(([subpath, target]) => [
        subpath,
        target.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js'),
      ]),
  );
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`compiled ${manifest.name}`);
}
