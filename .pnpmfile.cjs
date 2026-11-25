// typescript-eslint reads our code through TypeScript's JavaScript API. TypeScript 7, the native
// compiler this repo typechecks with, no longer ships that API, so the lint packages get
// TypeScript 6's instead (@typescript/typescript6, published by the TypeScript team for tools like
// this). Their `typescript` peer would otherwise resolve to our TypeScript 7 and fail.
// Only the lint packages are changed; `pnpm typecheck` stays on TypeScript 7.
// Remove this once typescript-eslint supports TypeScript 7.
// pnpm-lock.yaml stores a checksum of this file: after any edit (even a comment), run `pnpm install`
// and commit the lockfile, or CI's frozen install fails. lintRules.test.ts checks the result.
const TYPESCRIPT_6 = 'npm:@typescript/typescript6@6.0.2';
const LINT_PACKAGES = /^(typescript-eslint|@typescript-eslint\/.+|ts-api-utils)$/;

function readPackage(pkg) {
  if (LINT_PACKAGES.test(pkg.name) && pkg.peerDependencies?.typescript) {
    delete pkg.peerDependencies.typescript;
    pkg.dependencies = { ...pkg.dependencies, typescript: TYPESCRIPT_6 };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
