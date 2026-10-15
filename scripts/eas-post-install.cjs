const { spawnSync } = require('node:child_process');
if (process.env.EAS_BUILD_PROFILE === 'production') {
  const result = spawnSync(process.execPath, ['scripts/check-release.cjs'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
