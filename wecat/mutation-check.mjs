import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const file='open-sse/handlers/imageProviders/codex.js';
const source=fs.readFileSync(file,'utf8');
const marker='refs.forEach((url, index) => {';
if(source.split(marker).length!==2)throw Error('Mutation cần review lại khi upstream đổi buildContent');
try{
 fs.writeFileSync(file,source.replace(marker,'[].forEach((url, index) => {'));
 const r=spawnSync(process.execPath,['wecat/contract-check.mjs'],{encoding:'utf8'});
 if(r.status===0)throw Error('Test không bắt được lỗi bỏ ảnh tham chiếu');
 if(!r.stderr.includes('AssertionError'))throw Error('Mutation đỏ do setup, không phải lỗi ảnh tham chiếu');
 console.log('reference-image-mutation-caught');
}finally{fs.writeFileSync(file,source)}
