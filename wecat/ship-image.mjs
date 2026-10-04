// Nạp image đã qua gate từ máy operator sang host production qua SSH, không qua registry hay GitHub Actions.
// Dùng sau: DOCKER_DEFAULT_PLATFORM=linux/amd64 node wecat/check.mjs
//   node wecat/ship-image.mjs <ssh-host> [<ssh-host>...]
// Chỉ nạp image (docker load); không đổi container nào. Rollout theo wecat/RUNBOOK.md.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertReceipt, hashes, run } from './release.mjs';

const hosts = process.argv.slice(2);
if (!hosts.length) throw Error('Cần ít nhất một SSH host (alias trong ~/.ssh/config)');
for (const host of hosts) if (!/^[A-Za-z0-9][A-Za-z0-9._@-]*$/.test(host)) throw Error('SSH host không hợp lệ: ' + host);

run('git', ['diff', '--quiet']); run('git', ['diff', '--cached', '--quiet']);
const receipt = JSON.parse(fs.readFileSync('wecat/.reports/receipt.json', 'utf8'));
const commit = run('git', ['rev-parse', 'HEAD']);
const info = JSON.parse(run('docker', ['image', 'inspect', receipt.image]))[0];
assertReceipt(receipt, { commit, imageId: info.Id, lockHashes: hashes() });
if (info.Architecture !== 'amd64') throw Error(`Image là ${info.Architecture}; production cần amd64: chạy gate với DOCKER_DEFAULT_PLATFORM=linux/amd64`);

const version = info.Config.Labels['org.opencontainers.image.version'];
const tag = `wecat-9router:${version}-${commit.slice(0, 12)}`;
run('docker', ['tag', receipt.image, tag]);
for (const host of hosts) {
  // Tag và host đi qua tham số $0/$1, không ghép vào chuỗi lệnh.
  const r = spawnSync('sh', ['-c', 'docker save "$0" | gzip -1 | ssh "$1" "gunzip | docker load"', tag, host], { stdio: ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0) throw Error('Nạp image sang ' + host + ' thất bại');
  const remoteId = run('ssh', [host, 'docker', 'image', 'inspect', '--format', '{{.Id}}', tag]);
  if (remoteId !== info.Id) throw Error(`${host}: image ID ${remoteId} khác receipt ${info.Id}`);
  run('ssh', [host, 'mkdir -p /root/wecat-receipts && cat > /root/wecat-receipts/' + tag.replace(/[:/]/g, '_') + '.json'], { input: JSON.stringify(receipt, null, 2) + '\n', stdio: ['pipe', 'pipe', 'pipe'] });
  console.log(`${host}: ${tag} ${remoteId}`);
}
console.log(`Đã nạp ${tag}; chưa đổi container nào. Tiếp theo: rollout theo wecat/RUNBOOK.md.`);
