// Logic dùng chung cho việc theo dõi và nâng upstream decolua/9router.
// Hàm thuần (không gọi git/mạng) được export riêng để test trong wecat/tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run, sha256 } from './release.mjs';

export const UPSTREAM_URL = 'https://github.com/decolua/9router.git';

// Những vùng upstream mà WeCat phụ thuộc trực tiếp. Mỗi mục là một việc cần review,
// không phải lỗi: gate vẫn là nơi quyết định candidate có đạt hay không.
export const RISK_RULES = [
  { id: 'ip-patch', match: f => f === 'custom-server.js', note: 'custom-server.js đổi: patch IP (wecat/patch-ip.mjs) có thể không áp được, ops test sẽ báo.' },
  { id: 'sqlite', match: f => f.startsWith('src/lib/db/'), note: 'Tầng SQLite đổi: kiểm migration, backup trước rollout và khả năng rollback image cũ trên DB mới.' },
  { id: 'dependencies', match: f => f === 'package.json' || f === 'tests/package.json', note: 'Manifest dependency đổi: lockfile trong wecat/locks/ được tạo lại, cần review diff lock.' },
  { id: 'dockerfile', match: f => f === 'Dockerfile' || f === '.dockerignore', note: 'Dockerfile upstream đổi: đối chiếu và chép phần cần thiết sang wecat/Dockerfile.' },
  { id: 'image-path', match: f => /^open-sse\/handlers\/imageProviders\/|^src\/sse\/handlers\/imageGeneration\.js$|^open-sse\/config\/providerModels\.js$/.test(f), note: 'Đường sinh ảnh/Codex model mà WeCat dùng đổi: contract-check và mutation-check phải còn đúng.' },
  { id: 'token-refresh', match: f => /token-?refresh|tokenRefresh/i.test(f), note: 'Token refresh đổi: chú ý không để hai writer cùng refresh tài khoản khi rollout.' },
  { id: 'workflows', match: f => f.startsWith('.github/workflows/'), note: 'Workflow upstream đổi: workflow phát hành của upstream phải còn guard `github.repository == decolua/9router`.' },
];

export function parseVersion(tag) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(tag).trim());
  return m ? m.slice(1).map(Number) : null;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

// Chọn tag phát hành mới nhất (vX.Y.Z); bỏ qua tag không theo semver.
export function latestReleaseTag(tags) {
  const releases = tags.map(tag => ({ tag, version: parseVersion(tag) })).filter(x => x.version);
  releases.sort((a, b) => compareVersions(a.version, b.version));
  return releases.at(-1)?.tag || null;
}

export function classifyChanges(files) {
  return RISK_RULES.map(rule => ({ id: rule.id, note: rule.note, files: files.filter(rule.match) }))
    .filter(risk => risk.files.length);
}

export function updatedValidation(config, { commit, version, manifests }) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Upstream commit phải là full SHA');
  return {
    ...config,
    acceptedUpstreamCommit: commit,
    upstreamVersion: version,
    packageManifestSha256: manifests.package,
    testManifestSha256: manifests.tests,
    toolManifestSha256: manifests.tools,
  };
}

export function formatReport({ fromVersion, toVersion, fromCommit, toCommit, commits, files, risks, locksRegenerated = [] }) {
  const lines = [
    `## Upstream ${fromVersion} → ${toVersion}`,
    '',
    `- Upstream: [decolua/9router@${toCommit.slice(0, 12)}](https://github.com/decolua/9router/commit/${toCommit})`,
    `- So sánh: https://github.com/decolua/9router/compare/${fromCommit.slice(0, 12)}...${toCommit.slice(0, 12)}`,
    `- ${commits} commit, ${files} file thay đổi`,
  ];
  if (locksRegenerated.length) lines.push(`- Lockfile đã tạo lại: ${locksRegenerated.join(', ')}`);
  lines.push('', '### Cần review');
  if (!risks.length) lines.push('', 'Không chạm vùng WeCat phụ thuộc trực tiếp. Gate vẫn phải đạt trước khi phát hành.');
  for (const risk of risks) {
    lines.push('', `- **${risk.id}**: ${risk.note}`);
    for (const file of risk.files.slice(0, 10)) lines.push(`  - \`${file}\``);
    if (risk.files.length > 10) lines.push(`  - … và ${risk.files.length - 10} file khác`);
  }
  return lines.join('\n') + '\n';
}

export function readValidation() {
  return JSON.parse(fs.readFileSync('wecat/validation.json', 'utf8'));
}

export function writeValidation(config) {
  fs.writeFileSync('wecat/validation.json', JSON.stringify(config, null, 2) + '\n');
}

export function manifestHashes() {
  return {
    package: sha256(fs.readFileSync('package.json')),
    tests: sha256(fs.readFileSync('tests/package.json')),
    tools: sha256(fs.readFileSync('wecat/package.json')),
  };
}

export function ensureUpstreamRemote() {
  const remotes = run('git', ['remote']).split('\n');
  if (!remotes.includes('upstream')) run('git', ['remote', 'add', 'upstream', UPSTREAM_URL]);
  if (run('git', ['remote', 'get-url', 'upstream']) !== UPSTREAM_URL) throw Error('Remote upstream không trỏ về decolua/9router');
}

// Trả về trạng thái giữa bản WeCat đã chấp nhận và ref upstream (mặc định: tag phát hành mới nhất).
export function upstreamState(ref) {
  ensureUpstreamRemote();
  run('git', ['fetch', '--quiet', '--tags', 'upstream', 'master']);
  const target = ref || latestReleaseTag(run('git', ['tag', '--list', 'v*']).split('\n'));
  if (!target) throw Error('Không tìm thấy tag phát hành upstream');
  const toCommit = run('git', ['rev-parse', (target === 'master' ? 'upstream/master' : target) + '^{commit}']);
  const config = readValidation();
  const fromCommit = config.acceptedUpstreamCommit;
  const toVersion = JSON.parse(run('git', ['show', toCommit + ':package.json'])).version;
  const upToDate = run('git', ['rev-list', '--count', `${fromCommit}..${toCommit}`]) === '0';
  const changed = upToDate ? [] : run('git', ['diff', '--name-only', fromCommit, toCommit]).split('\n').filter(Boolean);
  return {
    ref: target, fromCommit, toCommit, fromVersion: config.upstreamVersion, toVersion, upToDate,
    commits: Number(run('git', ['rev-list', '--count', `${fromCommit}..${toCommit}`])),
    files: changed.length, risks: classifyChanges(changed),
  };
}

// Tạo lại lockfile từ manifest mới, giữ nguyên version cũ cho dependency không đổi.
export function regenerateLock(manifest, lock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wecat-lock-'));
  try {
    fs.copyFileSync(manifest, path.join(dir, 'package.json'));
    fs.copyFileSync(lock, path.join(dir, 'package-lock.json'));
    run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dir });
    fs.copyFileSync(path.join(dir, 'package-lock.json'), lock);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
