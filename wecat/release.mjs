import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export function redact(value) {
  return String(value).replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk[-_]|gh[pousr]_)[A-Za-z0-9._-]+/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
export function assertReceipt(receipt, { commit, imageId, lockHashes }) {
  if (receipt.schema !== 1 || receipt.status !== 'passed') throw Error('Gate chưa đạt');
  if (!/^[a-f0-9]{40}$/.test(commit) || receipt.commit !== commit) throw Error('Bằng chứng khác commit');
  if (receipt.imageId !== imageId || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw Error('Bằng chứng khác image');
  for (const [name, hash] of Object.entries(lockHashes)) if (receipt.lockHashes?.[name] !== hash) throw Error('Lockfile đã thay đổi');
  const required = ['ops', 'contracts', 'critical', 'container'];
  for (const name of required) if (receipt.checks?.[name]?.status !== 'passed') throw Error('Thiếu check '+name);
  if (receipt.realProviderCalls !== 0) throw Error('Gate local phải dùng dữ liệu giả lập');
  return true;
}
export function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}
export function hashes() {
  return {...Object.fromEntries(['application','tests'].map(name => [name, sha256(fs.readFileSync(`wecat/locks/${name}.package-lock.json`))])),tools:sha256(fs.readFileSync('wecat/package-lock.json'))};
}
export function restoreLocks() {
  fs.copyFileSync('wecat/locks/application.package-lock.json', 'package-lock.json');
  fs.copyFileSync('wecat/locks/tests.package-lock.json', 'tests/package-lock.json');
}
export function requireLocalUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.username || url.password) throw Error('Smoke local chỉ được gọi loopback HTTP');
  return url;
}
