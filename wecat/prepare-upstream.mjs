// Tạo nhánh candidate nâng upstream: merge, cập nhật validation.json/lockfile, ghi báo cáo review.
// Dùng: node wecat/prepare-upstream.mjs [vX.Y.Z|master] [--no-commit] [--push] [--pr]
// Mặc định lấy tag phát hành mới nhất của upstream. Không bao giờ push master hay deploy.
import fs from 'node:fs';
import { run } from './release.mjs';
import {
  upstreamState, formatReport, readValidation, writeValidation, updatedValidation,
  manifestHashes, regenerateLock,
} from './upstream.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const ref = args.find(a => !a.startsWith('--'));
if (ref && !/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(ref)) throw Error('Upstream ref không hợp lệ');
if (flags.has('--pr') && flags.has('--no-commit')) throw Error('--pr cần commit; bỏ --no-commit');

if (run('git', ['status', '--porcelain'])) throw Error('Working tree có thay đổi; commit hoặc dùng worktree riêng trước');
run('git', ['fetch', '--quiet', 'origin', 'master']);
const state = upstreamState(ref);
if (state.upToDate) {
  console.log(`Fork đã gồm upstream ${state.ref} (${state.toVersion}); không có gì để nâng.`);
  process.exit(0);
}

const branch = `wecat/upstream-${state.toVersion}-${state.toCommit.slice(0, 12)}`;
run('git', ['switch', '-c', branch, 'origin/master']);
try {
  run('git', ['merge', '--no-ff', '--no-commit', state.toCommit]);
} catch {
  const conflicts = run('git', ['diff', '--name-only', '--diff-filter=U']);
  console.error(`Merge có conflict trên ${branch}; giữ nguyên để review, không tự reset:\n${conflicts}`);
  console.error(formatReport(state));
  process.exit(1);
}

// Manifest đổi thì tạo lại lockfile đã ghim trước khi ghi hash mới vào validation.json.
const before = readValidation();
const manifests = manifestHashes();
const locksRegenerated = [];
if (manifests.package !== before.packageManifestSha256) {
  regenerateLock('package.json', 'wecat/locks/application.package-lock.json');
  locksRegenerated.push('application');
}
if (manifests.tests !== before.testManifestSha256) {
  regenerateLock('tests/package.json', 'wecat/locks/tests.package-lock.json');
  locksRegenerated.push('tests');
}
writeValidation(updatedValidation(before, { commit: state.toCommit, version: state.toVersion, manifests }));

const report = formatReport({ ...state, locksRegenerated });
fs.mkdirSync('wecat/.reports', { recursive: true });
const reportFile = `wecat/.reports/upstream-${state.toVersion}.md`;
fs.writeFileSync(reportFile, report);
console.log(report);

if (flags.has('--no-commit')) {
  console.log(`Đã merge (chưa commit) trên ${branch}. Review rồi commit, chạy node wecat/check.mjs và mở PR.`);
  process.exit(0);
}
run('git', ['add', '-A']);
run('git', ['commit', '-q', '-m', `chore(wecat): nâng upstream lên ${state.toVersion} (${state.toCommit.slice(0, 12)})`, '-m', report]);
console.log(`Đã commit trên ${branch}.`);

if (flags.has('--push') || flags.has('--pr')) run('git', ['push', '-u', 'origin', branch]);
if (flags.has('--pr')) {
  const body = report + '\n---\nTạo bởi `node wecat/prepare-upstream.mjs`. Chạy gate trên máy operator (`node wecat/check.mjs`) và ghi kết quả vào PR trước khi merge; chưa có deploy production.\n';
  console.log(run('gh', ['pr', 'create', '--repo', 'wecat-team/9router', '--base', 'master', '--head', branch,
    '--title', `Nâng upstream 9Router lên ${state.toVersion}`, '--body', body]));
} else {
  console.log('Tiếp theo: node wecat/check.mjs, rồi push và mở PR (hoặc chạy lại với --pr).');
}
