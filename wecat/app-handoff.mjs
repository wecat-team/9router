// Sinh prompt bàn giao cho agent ở repo app (app.wecat.vn) sau khi nâng 9Router lên production.
// So catalog/đường model Codex giữa hai ref upstream, tùy chọn thử thật từng model qua gateway,
// rồi in prompt có sẵn bối cảnh để agent bên app mở PR đồng bộ model trước khi gateway gỡ hẳn.
// Dùng: node wecat/app-handoff.mjs <ref-cũ> [ref-mới] [--usage <file.json>] [--models a,b] [--probe-live --allow-live]
// Hàm thuần được export để test trong wecat/tests/app-handoff.test.mjs; không in hostname, key hay ảnh.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { run } from './release.mjs';
import { readValidation } from './upstream.mjs';
import { referencePng, verifyPng } from './fixtures.mjs';

const REGISTRY = 'open-sse/providers/registry/codex.js';
const IMAGE_PROVIDER = 'open-sse/handlers/imageProviders/codex.js';
const PRICING = 'open-sse/providers/pricing.js';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const PROBE_TIMEOUT_MS = 180000;

// Biến thể không dùng cho app: context mở rộng [1m], quota review, model ảo của Codex CLI và STT.
function isAppFacing(id, kind) {
  return !id.includes('[') && !id.endsWith('-review') && id !== 'codex-auto-review' && kind !== 'stt';
}

export function parseCodexCatalog(source) {
  const models = [];
  for (const line of source.split('\n')) {
    if (line.trim().startsWith('//')) continue;
    const match = line.match(/\{\s*id:\s*"([^"]+)"([^}]*)\}/);
    if (!match) continue;
    const kind = (match[2].match(/kind:\s*"([^"]+)"/) || [])[1] || 'chat';
    if (isAppFacing(match[1], kind)) models.push({ id: match[1], kind });
  }
  return models;
}

export function parseImageRouting(source) {
  const mainModel = (source.match(/const CODEX_IMAGES_MAIN_MODEL\s*=\s*"([^"]+)"/) || [])[1] || null;
  const block = (source.match(/CODEX_TOOL_IMAGE_MODELS\s*=\s*new Set\(\[([\s\S]*?)\]\)/) || [])[1] || '';
  return { mainModel, toolModels: [...block.matchAll(/"([^"]+)"/g)].map(m => m[1]) };
}

// Bảng giá có nhiều khối (aggregator dùng id có prefix "openai/…"); lấy dòng đầu tiên khớp đúng id trần.
export function parsePricing(source, ids) {
  const prices = {};
  for (const id of ids) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(`^\\s*"${escaped}":\\s*\\{\\s*input:\\s*([\\d.]+),\\s*output:\\s*([\\d.]+)`, 'm'));
    if (match) prices[id] = { input: Number(match[1]), output: Number(match[2]) };
  }
  return prices;
}

export function codexStateAt(ref) {
  const read = file => run('git', ['show', `${ref}:${file}`]);
  const catalog = parseCodexCatalog(read(REGISTRY));
  const routing = parseImageRouting(read(IMAGE_PROVIDER));
  const chatIds = new Set(catalog.filter(m => m.kind === 'chat').map(m => m.id));
  if (routing.mainModel) chatIds.add(routing.mainModel);
  return { version: JSON.parse(read('package.json')).version, catalog, routing, pricing: parsePricing(read(PRICING), [...chatIds]) };
}

export function diffCodex(before, after) {
  const key = m => m.id + '|' + m.kind;
  const beforeKeys = new Set(before.catalog.map(key)), afterKeys = new Set(after.catalog.map(key));
  const added = after.catalog.filter(m => !beforeKeys.has(key(m)));
  const removed = before.catalog.filter(m => !afterKeys.has(key(m)));
  const mainModel = before.routing.mainModel !== after.routing.mainModel ? { from: before.routing.mainModel, to: after.routing.mainModel } : null;
  const toolsChanged = before.routing.toolModels.join() !== after.routing.toolModels.join();
  const priceChanges = Object.keys(after.pricing)
    .filter(id => before.pricing[id] && JSON.stringify(before.pricing[id]) !== JSON.stringify(after.pricing[id]))
    .map(id => ({ id, from: before.pricing[id], to: after.pricing[id] }));
  const relevant = added.length + removed.length + priceChanges.length > 0 || Boolean(mainModel) || toolsChanged;
  return { added, removed, mainModel, toolsChanged, priceChanges, relevant };
}

const cx = id => '`cx/' + id + '`';
const price = p => (p ? `${p.input} / ${p.output}` : 'chưa có giá');
const list = (models, empty) => (models.length ? models.map(m => `- ${cx(m.id)} (${m.kind})`).join('\n') : empty);

function catalogSection(after) {
  const chat = after.catalog.filter(m => m.kind === 'chat');
  const image = after.catalog.filter(m => m.kind === 'image');
  const tools = new Set(after.routing.toolModels);
  const imageNote = m => (tools.has(m.id) ? `tool, điều phối bởi \`${after.routing.mainModel}\`` : `model chính \`${m.id.replace(/-image$/, '')}\``);
  return [
    '| Model chat | Giá vào/ra ($/1M token) |', '|---|---|',
    ...chat.map(m => `| ${cx(m.id)} | ${price(after.pricing[m.id])} |`),
    '', '| Model ảnh | Tính token theo |', '|---|---|',
    ...image.map(m => `| ${cx(m.id)} | ${imageNote(m)} |`),
  ].join('\n');
}

function probeSection(probe) {
  if (!probe?.length) return 'Chưa có kết quả thử thật. Trước khi đổi mặc định, thử từng model liên quan ở trên với đúng payload của app (ảnh: 2 ảnh tham chiếu, `response_format=binary`) và ghi kết quả vào PR.';
  const row = p => `| cx/${p.model.replace(/^cx\//, '')} | ${p.kind} | ${p.status} | ${(p.elapsedMs / 1000).toFixed(1)} s | ${p.width ? `${p.width}x${p.height}` : (p.error || '')} |`;
  return ['| Model | Loại | HTTP | Thời gian | Kết quả |', '|---|---|---|---|---|', ...probe.map(row)].join('\n');
}

function usageSection(usage) {
  if (!usage?.length) return 'Chưa có số liệu. Lấy số request thành công 14 ngày theo model từ gateway (xem wecat/APP-SYNC.md) để biết model nào app đang thật sự gọi.';
  return ['| Model | Request thành công |', '|---|---|', ...usage.map(u => `| ${cx(u.model)} | ${u.n} |`)].join('\n');
}

function changeSection(diff) {
  const parts = [
    '### Model bị gỡ khỏi catalog', list(diff.removed, 'Không có.'),
    '', '### Model mới trong catalog', list(diff.added, 'Không có.'),
  ];
  if (diff.mainModel) parts.push('', '### Model điều phối ảnh dạng tool (`gpt-image-*`)', `\`${diff.mainModel.from}\` → \`${diff.mainModel.to}\`. Ảnh vẫn do model tool vẽ; token phần điều phối tính theo model mới.`);
  if (diff.toolsChanged) parts.push('', 'Danh sách model ảnh dạng tool đã đổi; đối chiếu bảng catalog bên dưới.');
  if (diff.priceChanges.length) parts.push('', '### Giá đổi', ...diff.priceChanges.map(c => `- ${cx(c.id)}: ${price(c.from)} → ${price(c.to)}`));
  return parts.join('\n');
}

const TASKS = `1. Tìm mọi chỗ ghi cứng hoặc lưu trong DB tên model \`cx/...\`: hằng số mặc định, danh sách option, schema/validation, preset người dùng, cấu hình pipeline, job đang chờ. Tiền lệ: migration đã map model cũ sang model mới.
2. Model bị gỡ khỏi catalog: ngừng dùng làm mặc định. Vẫn chấp nhận id cũ để preset/job cũ không lỗi (hàm chuẩn hoá id), nhưng chuyển mặc định sang model còn trong catalog đã thử đạt ở trên.
3. Model mới: chỉ thêm vào option/mặc định khi đã thử thật đạt với đúng payload của app. Ưu tiên model rẻ cho việc nhẹ (copy, tag, viết prompt), model mạnh hơn cho vision/phân tích.
4. Fallback ở tầng gọi gateway: khi gateway trả 400/404 kiểu "model is not supported", "model_not_found", "Unknown model" thì thử lại đúng 1 lần với model dự phòng còn chạy; log model gốc, model dự phòng, lý do. Không fallback với 429/5xx (gateway tự xoay tài khoản).
5. Không đụng provider khác ngoài provider gọi gateway 9Router.
6. Test: chuẩn hoá id cũ, mặc định mới, fallback (400 model-not-supported → retry 1 lần; 429/5xx → không retry); chạy toàn bộ test suite của repo.
7. Đổi mặc định ảnh: chạy A/B trên 3–5 ảnh sản phẩm thật (cùng prompt, cùng ảnh tham chiếu) giữa model cũ và model mới, lưu ảnh để người dùng chấm. Model mới kém rõ rệt thì dừng và báo lại.
8. Mở PR: lý do (thay đổi phía gateway ở trên), bảng mặc định cũ/mới, fallback, kết quả test/A-B. Không merge, không deploy production khi chưa có người dùng duyệt.
9. Khi được duyệt: deploy theo quy trình sẵn có của repo app, theo dõi log worker 30 phút sau deploy: tỉ lệ HTTP 200 của /v1/images và /v1/chat qua gateway, không còn lỗi model-not-supported, không còn request tới model đã gỡ (trừ job cũ).
Không commit secret, API key, cookie, hostname production hay ảnh/prompt khách hàng.`;

export function formatHandoff({ fromVersion, toVersion, diff, after, probe, usage }) {
  if (!diff.relevant) return null;
  return [
    `# Đồng bộ model app.wecat.vn với 9Router ${fromVersion} → ${toVersion}`,
    '',
    '## Bối cảnh',
    `App gọi gateway 9Router qua biến WECAT_BASE_URL (provider "wecat", model prefix \`cx/\`). Hai production đã nâng 9Router ${fromVersion} → ${toVersion}. Bản này đổi catalog hoặc đường model Codex như dưới. Request tới model bị gỡ có thể vẫn chạy (gateway chuyển tiếp model không có trong catalog) nhưng không còn được bảo đảm ở bản sau.`,
    '', '## Thay đổi phía gateway', changeSection(diff),
    '', `## Catalog Codex hiện tại (${toVersion})`, catalogSection(after),
    '', 'Giá là ước tính 9Router dùng cho trang Usage, không phải hóa đơn: Codex qua OAuth trừ quota tài khoản. Chỉ dùng để so tương đối.',
    '', '## Kết quả thử thật trên gateway', probeSection(probe),
    '', '## Model app đang gọi (gateway)', usageSection(usage),
    '', '## Việc cần làm (một PR ở repo app)', TASKS,
  ].join('\n') + '\n';
}

export function checkBaseUrl(value) {
  const base = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !loopback) || base.username || base.password || base.search || base.hash) {
    throw Error('Base URL phải là HTTPS hoặc HTTP loopback, không chứa credential/query');
  }
  return base.toString().replace(/\/$/, '');
}

async function readPng(response) {
  const reader = response.body.getReader();
  const parts = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_IMAGE_BYTES) { await reader.cancel(); throw Error('ảnh vượt 20 MiB'); }
    parts.push(Buffer.from(value));
  }
  return verifyPng(Buffer.concat(parts));
}

async function probeOne(base, headers, { id, kind }) {
  const started = Date.now();
  const png = 'data:image/png;base64,' + referencePng().toString('base64');
  const [endpoint, body] = kind === 'image'
    ? ['/images/generations?response_format=binary', { model: 'cx/' + id, prompt: 'A minimal white image with a small centered blue circle. Use the attached images as references.', images: [png, png], size: '1024x1024', quality: 'low', image_detail: 'high', output_format: 'png', n: 1 }]
    : ['/chat/completions', { model: 'cx/' + id, messages: [{ role: 'user', content: 'Reply with exactly WECAT_PROBE_OK.' }], max_tokens: 32, stream: false }];
  try {
    const response = await fetch(base + endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const result = { model: id, kind, status: response.status };
    if (response.status !== 200) return { ...result, elapsedMs: Date.now() - started, error: (await response.text()).slice(0, 120) };
    if (kind === 'image') return { ...result, ...(await readPng(response)), elapsedMs: Date.now() - started };
    const ok = (await response.text()).includes('WECAT_PROBE_OK');
    return { ...result, elapsedMs: Date.now() - started, ...(ok ? {} : { error: 'thiếu chuỗi mong đợi' }) };
  } catch (error) {
    return { model: id, kind, status: 0, elapsedMs: Date.now() - started, error: error.message.slice(0, 120) };
  }
}

// Gọi tuần tự để không dồn tải lên gateway; mỗi model một request, có dùng quota.
export async function probeModels({ baseUrl, apiKey, allowLive, models }) {
  if (!allowLive) throw Error('Thử thật cần cờ --allow-live; có sử dụng quota provider');
  if (!apiKey) throw Error('Thiếu WECAT_CANARY_API_KEY');
  const base = checkBaseUrl(baseUrl);
  const headers = { authorization: 'Bearer ' + apiKey, 'content-type': 'application/json' };
  const results = [];
  for (const model of models) results.push(await probeOne(base, headers, model));
  return results;
}

// Mặc định thử: model mới, model bị gỡ (xem còn chuyển tiếp được không) và một tool ảnh khi model điều phối đổi.
export function modelsToProbe(diff, after, override) {
  if (override) {
    const kinds = new Map(after.catalog.map(m => [m.id, m.kind]));
    return override.map(id => ({ id, kind: kinds.get(id) || (id.endsWith('-image') || id.startsWith('gpt-image') ? 'image' : 'chat') }));
  }
  const picked = [...diff.added, ...diff.removed];
  if (diff.mainModel && after.routing.toolModels[0]) picked.push({ id: after.routing.toolModels[0], kind: 'image' });
  return picked.filter((m, i) => picked.findIndex(x => x.id === m.id) === i);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args) {
  const refs = args.filter((a, i) => !a.startsWith('--') && !['--usage', '--models'].includes(args[i - 1]));
  if (!refs[0]) throw Error('Dùng: node wecat/app-handoff.mjs <ref-cũ> [ref-mới] [--usage file.json] [--models a,b] [--probe-live --allow-live]');
  const before = codexStateAt(refs[0]);
  const after = codexStateAt(refs[1] || readValidation().acceptedUpstreamCommit);
  const diff = diffCodex(before, after);
  const usageFile = option(args, '--usage');
  const usage = usageFile ? JSON.parse(fs.readFileSync(usageFile, 'utf8')) : undefined;
  const probe = args.includes('--probe-live')
    ? await probeModels({ baseUrl: process.env.WECAT_CANARY_BASE_URL, apiKey: process.env.WECAT_CANARY_API_KEY, allowLive: args.includes('--allow-live'), models: modelsToProbe(diff, after, option(args, '--models')?.split(',')) })
    : undefined;
  const text = formatHandoff({ fromVersion: before.version, toVersion: after.version, diff, after, probe, usage });
  if (!text) { console.log(`Không có thay đổi model Codex ảnh hưởng app giữa ${before.version} và ${after.version}; không cần bàn giao.`); return; }
  fs.mkdirSync('wecat/.reports', { recursive: true });
  const file = `wecat/.reports/app-handoff-${after.version}.md`;
  fs.writeFileSync(file, text);
  console.log(text);
  console.error(`Đã ghi ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}
