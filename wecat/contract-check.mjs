import assert from 'node:assert/strict';
import codex from '../open-sse/handlers/imageProviders/codex.js';
import { CODEX_CLI_VERSION } from '../open-sse/config/appConstants.js';
import { getModelsByProviderId } from '../open-sse/config/providerModels.js';
const models=['gpt-5.6-luna-image','gpt-5.6-sol-image','gpt-5.6-terra-image','gpt-5.5-image'];
const refs=['data:image/png;base64,c291cmNl','data:image/png;base64,cmVmMQ==','data:image/png;base64,cmVmMg=='];
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Contract test không được gọi mạng')};
let passed=0;
try {
  const version=CODEX_CLI_VERSION.split('.').map(Number);assert.ok(version[0]>0||version[1]>=155,'Codex client version thấp hơn baseline đã chạy production');
  const catalog=getModelsByProviderId('codex');
  for(const model of models){
    assert.ok(catalog.some(x=>x.id===model&&x.kind==='image'), 'Model image bị mất: '+model);
    for(const inputs of [[],[refs[0]],refs]){
      const body={prompt:'offline contract',size:'1024x1024',quality:'high',output_format:'png',image_detail:'high'};
      if(inputs.length===1)body.image=inputs[0];else if(inputs.length)body.images=inputs;
      const result=codex.buildBody(model,body);
      assert.equal(result.model,model.replace(/-image$/,''));
      assert.deepEqual(result.input[0].content.filter(x=>x.type==='input_image').map(x=>x.image_url),inputs);
      assert.ok(result.input[0].content.filter(x=>x.type==='input_image').every(x=>x.detail==='high'));
      assert.equal(result.tools[0].size,body.size);assert.equal(result.tools[0].quality,body.quality);assert.equal(result.tools[0].output_format,'png');passed++;
    }
  }
  const stream='event: response.output_item.done\ndata: '+JSON.stringify({item:{type:'image_generation_call',result:'b2ZmbGluZQ=='}})+'\n\n';
  const result=await codex.parseResponse(new Response(stream),{streamToClient:false});assert.equal(result.data[0].b64_json,'b2ZmbGluZQ==');passed++;
  const route=await import('node:fs/promises');
  assert.match(await route.readFile('src/sse/handlers/imageGeneration.js','utf8'), /searchParams\.get\("response_format"\) === "binary"/);
  passed++;
  console.log(JSON.stringify({checks:passed,realProviderCalls:0,status:'passed'}));
} finally {globalThis.fetch=originalFetch;}
