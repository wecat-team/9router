import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { latestReleaseTag, classifyChanges, updatedValidation, formatReport, forkDrift, isForkOwned, isAncestor, treeDrift, applyUpstreamDiff } from '../upstream.mjs';

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

test('file fork sở hữu và phát hiện file lệch ngoài vùng fork', () => {
  assert.ok(isForkOwned('wecat/check.mjs') && isForkOwned('.github/README.md') && isForkOwned('AGENTS.md'));
  assert.ok(!isForkOwned('open-sse/handlers/chatCore.js') && !isForkOwned('wecatx/a.js'));
  assert.deepEqual(forkDrift(['wecat/a', 'CLAUDE.md', 'tests/__baseline__/providers-baseline.json', '']), ['tests/__baseline__/providers-baseline.json']);
});

test('báo cáo ghi rõ chế độ áp diff', () => {
  const report = formatReport({ fromVersion: '1', toVersion: '2', fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(40), commits: 1, files: 1, risks: [], mode: 'diff' });
  assert.match(report, /Cách áp: diff `aaaaaaaaaaaa\.\.bbbbbbbbbbbb`/);
});

// Repo tạm mô phỏng đúng chuỗi: fork merge v1, nâng v2 bằng squash (mất tổ tiên), upstream v3 sửa lại cùng dòng.
function squashedFork() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wecat-upstream-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  git('init', '-q', '-b', 'master'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 'test'); git('config', 'commit.gpgsign', 'false');
  write('app.js', 'line1\nversion=1\nline3\n'); write('CLAUDE.md', 'upstream\n'); write('logo.bin', Buffer.from([0, 1, 2, 3]));
  git('add', '-A'); git('commit', '-qm', 'v1'); const v1 = git('rev-parse', 'HEAD');
  write('app.js', 'line1\nversion=2\nline3\n'); write('logo.bin', Buffer.from([0, 1, 2, 4])); git('commit', '-qam', 'v2'); const v2 = git('rev-parse', 'HEAD');
  write('app.js', 'line1\nversion=3\nline3\nnew\n'); write('added.js', 'x\n'); git('add', '-A'); git('commit', '-qm', 'v3'); const v3 = git('rev-parse', 'HEAD');
  git('switch', '-q', '-c', 'fork', v1);
  write('wecat/check.mjs', 'gate\n'); write('CLAUDE.md', 'fork block\nupstream\n'); git('add', '-A'); git('commit', '-qm', 'fork');
  // Squash merge v2: cây = v2 + phần fork, nhưng commit chỉ có cha là fork.
  git('checkout', '-q', v2, '--', 'app.js', 'logo.bin'); git('commit', '-qm', 'squash v2');
  return { dir, git, v1, v2, v3 };
}

test('sau squash merge, áp diff upstream không sinh conflict giả và cây khớp upstream', () => {
  const { dir, git, v2, v3 } = squashedFork();
  try {
    assert.equal(isAncestor(v2, 'HEAD', dir), false);
    assert.deepEqual(treeDrift(v2, dir), []);
    // Đối chứng: merge thường dùng merge-base v1 nên conflict ở app.js dù fork không sửa file này.
    assert.throws(() => git('merge', '--no-commit', v3));
    assert.match(git('diff', '--name-only', '--diff-filter=U'), /app\.js/);
    git('merge', '--abort');
    assert.deepEqual(applyUpstreamDiff(v2, v3, dir), []);
    assert.deepEqual(treeDrift(v3, dir), []);
    assert.equal(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'), 'line1\nversion=3\nline3\nnew\n');
    assert.equal(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'fork block\nupstream\n');
    assert.deepEqual([...fs.readFileSync(path.join(dir, 'logo.bin'))], [0, 1, 2, 4]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('file ngoài vùng fork bị lệch thì drift báo ra', () => {
  const { dir, v2 } = squashedFork();
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'trộn sai\n');
    assert.deepEqual(treeDrift(v2, dir), ['app.js']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('conflict thật ở file fork sở hữu được trả về, không tự giải', () => {
  const { dir, git, v2 } = squashedFork();
  try {
    git('switch', '-q', '-c', 'up4', v2);
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'upstream đổi\n'); git('commit', '-qam', 'v4'); const v4 = git('rev-parse', 'HEAD');
    git('switch', '-q', 'fork');
    assert.deepEqual(applyUpstreamDiff(v2, v4, dir), ['CLAUDE.md']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
