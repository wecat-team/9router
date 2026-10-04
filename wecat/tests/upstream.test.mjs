import test from 'node:test';
import assert from 'node:assert/strict';
import { latestReleaseTag, classifyChanges, updatedValidation, formatReport } from '../upstream.mjs';

test('chọn tag phát hành mới nhất theo semver, bỏ tag lạ', () => {
  assert.equal(latestReleaseTag(['v0.5.9', 'v0.5.95', 'v0.5.100', 'nightly', 'v1.0.0-rc1']), 'v0.5.100');
  assert.equal(latestReleaseTag(['nightly']), null);
});

test('đánh dấu các vùng WeCat phụ thuộc khi upstream đổi', () => {
  const risks = classifyChanges([
    'custom-server.js', 'src/lib/db/migrations/002_x.js', 'package.json', 'Dockerfile',
    'open-sse/handlers/imageProviders/codex.js', '.github/workflows/docker-publish.yml', 'README.md',
  ]);
  assert.deepEqual(risks.map(r => r.id), ['ip-patch', 'sqlite', 'dependencies', 'dockerfile', 'image-path', 'workflows']);
  assert.deepEqual(classifyChanges(['README.md', 'src/app/page.js']), []);
});

test('validation.json chỉ đổi commit, version và hash manifest', () => {
  const config = { schema: 1, criticalSuites: ['a'], nodeImage: 'node@sha256:x', acceptedUpstreamCommit: 'old' };
  const next = updatedValidation(config, { commit: 'a'.repeat(40), version: '0.6.0', manifests: { package: 'p', tests: 't', tools: 'w' } });
  assert.equal(next.acceptedUpstreamCommit, 'a'.repeat(40));
  assert.equal(next.upstreamVersion, '0.6.0');
  assert.deepEqual([next.packageManifestSha256, next.testManifestSha256, next.toolManifestSha256], ['p', 't', 'w']);
  assert.deepEqual(next.criticalSuites, ['a']);
  assert.equal(next.nodeImage, 'node@sha256:x');
  assert.throws(() => updatedValidation(config, { commit: 'abc', version: '1', manifests: {} }), /full SHA/);
});

test('báo cáo có link upstream và nêu rõ khi không chạm vùng phụ thuộc', () => {
  const report = formatReport({ fromVersion: '0.5.95', toVersion: '0.5.96', fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(40), commits: 3, files: 2, risks: [] });
  assert.match(report, /0\.5\.95 → 0\.5\.96/);
  assert.match(report, /compare\/aaaaaaaaaaaa\.\.\.bbbbbbbbbbbb/);
  assert.match(report, /Không chạm vùng WeCat phụ thuộc/);
});
