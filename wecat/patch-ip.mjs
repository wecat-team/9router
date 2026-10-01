import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
export function patchIp(source) {
  const marker = 'const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;';
  if (source.split(marker).length !== 2) throw Error('custom-server.js đổi cấu trúc: dừng để review patch IP');
  const helper = `\n// WeCat: chỉ tin đúng các proxy IP mà operator cấu hình.\nconst wecatNormalizeIp = ip => ip.startsWith('::ffff:') ? ip.slice(7) : ip;\nconst wecatTrustedProxies = new Set((process.env.WECAT_TRUSTED_PROXY_IPS || '').split(',').map(s => s.trim()).filter(Boolean).map(ip => {\n  if (!require('node:net').isIP(ip)) throw new Error('WECAT_TRUSTED_PROXY_IPS phải là danh sách IP chính xác, không phải CIDR/wildcard');\n  return wecatNormalizeIp(ip);\n}));\n`;
  // Upstream dùng CommonJS; đặt helper sau import http để giữ lời gọi require sẵn có.
  const anchor = 'const http = require("http");';
  if (!source.includes(anchor)) throw Error('Không tìm thấy import http của custom-server');
  return source.replace(anchor, anchor+helper).replace(marker, 'const ip = (isLoopbackProxy || wecatTrustedProxies.has(wecatNormalizeIp(socketIp))) && proxyIp ? proxyIp : socketIp;');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw Error('Cần đường dẫn custom-server.js');
  fs.writeFileSync(file, patchIp(fs.readFileSync(file, 'utf8')));
  console.log('wecat-ip-patch-ok');
}
