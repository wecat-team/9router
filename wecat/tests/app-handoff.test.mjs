import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  parseCodexCatalog, parseImageRouting, parsePricing, diffCodex, formatHandoff, checkBaseUrl, codexStateAt,
} from '../app-handoff.mjs';

const registryBefore = `
  models: [
    { id: "gpt-6-sol", name: "GPT 6.0 Sol", responsesLite: true },
    { id: "gpt-6-sol[1m]", name: "GPT 6.0 Sol (extended context)", upstreamModelId: "gpt-6-sol" },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "gpt-5.6-luna-review", name: "GPT 5.6 Luna Review", upstreamModelId: "gpt-5.6-luna", quotaFamily: "review" },
    { id: "gpt-image-2", name: "GPT Image 2", kind: "image" },
    { id: "gpt-5.6-luna-image", name: "GPT 5.6 Luna Image", kind: "image" },
    { id: "transcribe", name: "Codex Transcription", kind: "stt" },
  ],`;
const registryAfter = `
  models: [
    { id: "gpt-6-sol", name: "GPT 6.0 Sol", responsesLite: true },
    { id: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
    { id: "gpt-image-2", name: "GPT Image 2", kind: "image" },
    { id: "gpt-6-sol-image", name: "GPT 6.0 Sol Image", kind: "image" },
    // { id: "gpt-5.6-luna-image", name: "đã gỡ", kind: "image" },
  ],`;
const imageBefore = `
const CODEX_IMAGES_MAIN_MODEL = "gpt-5.6-terra";
const CODEX_TOOL_IMAGE_MODELS = new Set([
  "gpt-image-1.5",
  "gpt-image-2",
]);`;
const imageAfter = imageBefore.replace('gpt-5.6-terra', 'gpt-6-sol');
const pricing = `
  "gpt-5.6-luna":                 { input: 1.00,  output: 6.00,  cached: 0.10 },
  "gpt-6-sol":                    { input: 2.00,  output: 10.00, cached: 0.20 },
  aggregator: {
    "openai/gpt-6-sol": { input: 9, output: 99 },
  },`;

test('đọc catalog Codex: bỏ dòng comment, biến thể [1m]/-review và model stt', () => {
  assert.deepEqual(parseCodexCatalog(registryBefore), [
    { id: 'gpt-6-sol', kind: 'chat' },
    { id: 'gpt-5.6-luna', kind: 'chat' },
    { id: 'gpt-image-2', kind: 'image' },
    { id: 'gpt-5.6-luna-image', kind: 'image' },
  ]);
  assert.ok(!parseCodexCatalog(registryAfter).some(m => m.id === 'gpt-5.6-luna-image'), 'dòng comment không được tính');
});

test('đọc model điều phối và danh sách tool ảnh', () => {
  assert.deepEqual(parseImageRouting(imageBefore), { mainModel: 'gpt-5.6-terra', toolModels: ['gpt-image-1.5', 'gpt-image-2'] });
});

test('giá lấy dòng đầu tiên của đúng id, không lấy giá aggregator có prefix', () => {
  assert.deepEqual(parsePricing(pricing, ['gpt-6-sol', 'gpt-x']), { 'gpt-6-sol': { input: 2, output: 10 } });
});

test('diff phát hiện model thêm/gỡ, đổi model điều phối và đổi giá', () => {
  const before = { catalog: parseCodexCatalog(registryBefore), routing: parseImageRouting(imageBefore), pricing: { 'gpt-6-sol': { input: 2, output: 10 } } };
  const after = { catalog: parseCodexCatalog(registryAfter), routing: parseImageRouting(imageAfter), pricing: { 'gpt-6-sol': { input: 3, output: 10 } } };
  const diff = diffCodex(before, after);
  assert.deepEqual(diff.added, [{ id: 'gpt-6-sol-image', kind: 'image' }]);
  assert.deepEqual(diff.removed, [{ id: 'gpt-5.6-luna-image', kind: 'image' }]);
  assert.deepEqual(diff.mainModel, { from: 'gpt-5.6-terra', to: 'gpt-6-sol' });
  assert.deepEqual(diff.priceChanges, [{ id: 'gpt-6-sol', from: { input: 2, output: 10 }, to: { input: 3, output: 10 } }]);
  assert.equal(diff.relevant, true);
});

test('không có thay đổi model thì không sinh prompt', () => {
  const state = { catalog: parseCodexCatalog(registryAfter), routing: parseImageRouting(imageAfter), pricing: {} };
  const diff = diffCodex(state, state);
  assert.equal(diff.relevant, false);
  assert.equal(formatHandoff({ fromVersion: '0.5.1', toVersion: '0.5.2', diff, after: state }), null);
});

test('prompt nêu model bị gỡ, kết quả thử thật và không chứa hostname/credential', () => {
  const before = { catalog: parseCodexCatalog(registryBefore), routing: parseImageRouting(imageBefore), pricing: {} };
  const after = { catalog: parseCodexCatalog(registryAfter), routing: parseImageRouting(imageAfter), pricing: { 'gpt-6-sol': { input: 2, output: 10 } } };
  const text = formatHandoff({
    fromVersion: '0.5.109', toVersion: '0.5.111', diff: diffCodex(before, after), after,
    probe: [{ model: 'cx/gpt-6-sol-image', kind: 'image', status: 200, elapsedMs: 19056, width: 1254, height: 1254 }],
    usage: [{ model: 'gpt-5.6-luna-image', n: 183419 }],
  });
  assert.match(text, /0\.5\.109 → 0\.5\.111/);
  assert.match(text, /cx\/gpt-5\.6-luna-image/);
  assert.match(text, /cx\/gpt-6-sol-image \| image \| 200 \| 19\.1 s/);
  assert.match(text, /183419/);
  assert.match(text, /gpt-5\.6-terra` → `gpt-6-sol/);
  assert.doesNotMatch(text, /https?:\/\/|sk-[a-z0-9]|Bearer /i);
});

test('thiếu kết quả thử thật thì prompt yêu cầu agent tự thử trước khi đổi mặc định', () => {
  const before = { catalog: parseCodexCatalog(registryBefore), routing: parseImageRouting(imageBefore), pricing: {} };
  const after = { catalog: parseCodexCatalog(registryAfter), routing: parseImageRouting(imageAfter), pricing: {} };
  const text = formatHandoff({ fromVersion: '0.5.109', toVersion: '0.5.111', diff: diffCodex(before, after), after });
  assert.match(text, /Chưa có kết quả thử thật/);
});

test('base URL thử thật phải là HTTPS hoặc loopback, không chứa credential/query', () => {
  assert.doesNotThrow(() => checkBaseUrl('https://gateway.example/v1'));
  assert.doesNotThrow(() => checkBaseUrl('http://127.0.0.1:20128/v1'));
  assert.throws(() => checkBaseUrl('http://gateway.example/v1'));
  assert.throws(() => checkBaseUrl('https://user:pass@gateway.example/v1'));
  assert.throws(() => checkBaseUrl('https://gateway.example/v1?key=x'));
});

function hasRef(ref) {
  try { execFileSync('git', ['rev-parse', '--verify', '--quiet', ref + '^{commit}'], { stdio: 'ignore' }); return true; } catch { return false; }
}

test('với tag thật v0.5.109 → v0.5.111: gỡ nhóm gpt-5.6-*-image, thêm gpt-6-sol-image', { skip: !(hasRef('v0.5.109') && hasRef('v0.5.111')) && 'checkout không có tag upstream' }, () => {
  const diff = diffCodex(codexStateAt('v0.5.109'), codexStateAt('v0.5.111'));
  const removed = diff.removed.map(m => m.id);
  for (const id of ['gpt-5.6-luna-image', 'gpt-5.6-sol-image', 'gpt-5.6-terra-image']) assert.ok(removed.includes(id), id);
  assert.ok(diff.added.some(m => m.id === 'gpt-6-sol-image'));
  assert.deepEqual(diff.mainModel, { from: 'gpt-5.6-terra', to: 'gpt-6-sol' });
});
