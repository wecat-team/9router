import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { createRequire } from 'node:module';
import { patchIp } from '../patch-ip.mjs';
import { assertReceipt, redact, requireLocalUrl } from '../release.mjs';
import { createRouterGate } from '../ops/gate.mjs';
const require=createRequire(import.meta.url);
function seeHeaders(remote, forwarded, trusted) {
  let handler;let result;
  const fakeHttp={createServer: h=>{handler=h;return {once(){},emit(){return true}}}};
  const env={WECAT_TRUSTED_PROXY_IPS:trusted};
  const context={require:name=>name==='http'?fakeHttp:require(name),module:{},console,process:{env},__dirname:process.cwd(),setTimeout};
  context.require.main={};
  vm.runInNewContext(patchIp(fs.readFileSync('custom-server.js','utf8')),context);
  fakeHttp.createServer(req=>{result=req.headers});
  handler({socket:{remoteAddress:remote},headers:{'x-forwarded-for':forwarded,'x-9r-real-ip':'forged','x-9r-peer-token':'forged'}},{});
  return result;
}
test('patch tin proxy chính xác, bỏ header client giả và không tin IP khác',()=>{
  const a=seeHeaders('::ffff:192.0.2.10','198.51.100.7, 203.0.113.9','192.0.2.10');
  assert.equal(a['x-9r-real-ip'],'198.51.100.7');assert.notEqual(a['x-9r-peer-token'],'forged');assert.equal(a['x-forwarded-for'],undefined);
  const b=seeHeaders('192.0.2.11','198.51.100.7','192.0.2.10');assert.equal(b['x-9r-real-ip'],'192.0.2.11');
});
test('patch IP từ chối wildcard/CIDR và cấu trúc upstream thay đổi',()=>{
  assert.throws(()=>seeHeaders('192.0.2.10','198.51.100.7','*'),/IP chính xác/);
  assert.throws(()=>seeHeaders('192.0.2.10','198.51.100.7','192.0.2.0\/24'),/IP chính xác/);
  const src=fs.readFileSync('custom-server.js','utf8');
  assert.throws(()=>patchIp(src.replace('const ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;','const ip = socketIp;')),/đổi cấu trúc/);
  assert.throws(()=>patchIp(src+'\nconst ip = isLoopbackProxy && proxyIp ? proxyIp : socketIp;'),/đổi cấu trúc/);
});
test('receipt chặn commit/image/lock/check cũ và lệnh gọi production trong local smoke',()=>{
  const commit='a'.repeat(40),imageId='sha256:'+'b'.repeat(64),lockHashes={application:'one',tests:'two'};
  const r={schema:1,status:'passed',commit,imageId,lockHashes,realProviderCalls:0,checks:Object.fromEntries(['ops','contracts','critical','container'].map(n=>[n,{status:'passed'}]))};
  assert.equal(assertReceipt(r,{commit,imageId,lockHashes}),true);
  for(const bad of [{...r,commit:'c'.repeat(40)},{...r,imageId:'sha256:'+'d'.repeat(64)},{...r,lockHashes:{}},{...r,checks:{}},{...r,status:'failed'},{...r,realProviderCalls:1}])assert.throws(()=>assertReceipt(bad,{commit,imageId,lockHashes}));
  assert.throws(()=>requireLocalUrl('https://example.com'));assert.throws(()=>requireLocalUrl('http://127.0.0.1.evil.invalid'));
  assert.throws(()=>requireLocalUrl('http://user:password@localhost'));assert.equal(requireLocalUrl('http://127.0.0.1:20128').hostname,'127.0.0.1');
});
test('log che token, API key và password',()=>{
  const s=redact('Authorization: Bearer sk_secret ghp_abc password=private JWT eyJabc.eyJdef.signature');
  for(const x of ['sk_secret','ghp_abc','private','eyJabc'])assert.ok(!s.includes(x));
});
test('gate giữ request mới, cho request đang chạy hoàn tất rồi mở lại',async()=>{
  let finish;let oldStarted;const started=new Promise(r=>oldStarted=r);
  const upstream=http.createServer((req,res)=>{if(req.url==='/old'){oldStarted();finish=()=>res.end('old-ok')}else res.end('new-ok')});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const gate=createRouterGate({target:`http://127.0.0.1:${upstream.address().port}`,publicHost:'127.0.0.1',publicPort:0,adminPort:0,logger:{info(){}}});
  const addresses=await gate.listen();const base=`http://127.0.0.1:${addresses.publicAddress.port}`,admin=`http://127.0.0.1:${addresses.adminAddress.port}`;
  try{
    const old=fetch(base+'/old');await started;
    assert.equal((await fetch(admin+'/hold-if-idle',{method:'POST'})).status,409);
    assert.equal((await fetch(admin+'/hold',{method:'POST'})).status,200);
    const next=fetch(base+'/new');await new Promise(r=>setTimeout(r,30));
    assert.deepEqual(gate.status(),{held:true,active:1,queued:1});finish();assert.equal(await(await old).text(),'old-ok');
    assert.equal(gate.status().active,0);await fetch(admin+'/resume',{method:'POST'});assert.equal(await(await next).text(),'new-ok');
  }finally{await gate.close();await new Promise(r=>upstream.close(r));}
});

test('PNG canary phải có CRC và dữ liệu nén hợp lệ; ảnh 1px lỗi cũ bị từ chối',async()=>{
 const {referencePng,verifyPng}=await import('../fixtures.mjs');
 const good=referencePng();assert.deepEqual(verifyPng(good),{width:128,height:128});
 const bad=Buffer.from(good);bad[50]^=1;assert.throws(()=>verifyPng(bad),/CRC/);
 const old=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8\/x8AAusB9Wl6tS4AAAAASUVORK5CYII=','base64');assert.throws(()=>verifyPng(old));
});
test('canary thật phải có chấp thuận rõ và không nhận URL chứa credential',async()=>{
 const {liveCanary}=await import('../live-canary.mjs');
 await assert.rejects(liveCanary({baseUrl:'https://example.invalid/v1',apiKey:'test'}),/allow-live/);
 await assert.rejects(liveCanary({baseUrl:'http://example.invalid/v1',apiKey:'test',allowLive:true}),/HTTPS/);
 await assert.rejects(liveCanary({baseUrl:'https://user:pass@example.invalid/v1',apiKey:'test',allowLive:true}),/credential/);
});
test('request bị hủy khi đang xếp hàng không gọi upstream sau resume',async()=>{
 let calls=0;const upstream=http.createServer((req,res)=>{calls++;res.end('ok')});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const gate=createRouterGate({target:`http://127.0.0.1:${upstream.address().port}`,publicHost:'127.0.0.1',publicPort:0,adminPort:0,logger:{info(){}}});
 const a=await gate.listen(),base=`http://127.0.0.1:${a.publicAddress.port}`,admin=`http://127.0.0.1:${a.adminAddress.port}`;
 try{
  await fetch(admin+'/hold',{method:'POST'});const abort=new AbortController();const waiting=fetch(base+'/abandoned',{signal:abort.signal}).catch(()=>null);await new Promise(r=>setTimeout(r,30));assert.equal(gate.status().queued,1);abort.abort();await waiting;
  for(let i=0;i<30&&gate.status().queued;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(gate.status().queued,0);await fetch(admin+'/resume',{method:'POST'});assert.equal(calls,0);
 }finally{await gate.close();await new Promise(r=>upstream.close(r));}
});
