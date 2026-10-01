import { pathToFileURL } from 'node:url';
import { referencePng, verifyPng } from './fixtures.mjs';
export async function liveCanary({baseUrl,apiKey,allowLive=false,target='primary'}){
 if(!allowLive)throw Error('Canary thật cần cờ --allow-live; có sử dụng quota provider');
 const base=new URL(baseUrl);const loopback=['127.0.0.1','localhost','[::1]'].includes(base.hostname);
 if((base.protocol!=='https:'&&!loopback)||base.username||base.password||base.search||base.hash)throw Error('Base URL phải là HTTPS hoặc HTTP loopback, không chứa credential/query');
 if(!apiKey)throw Error('Thiếu WECAT_CANARY_API_KEY');if(!['primary','secondary'].includes(target))throw Error('Target không hợp lệ');
 const url=base.toString().replace(/\/$/,'');const headers={authorization:'Bearer '+apiKey,'content-type':'application/json'};const checks=[];
 async function post(endpoint,body){const t=Date.now();const r=await fetch(url+endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});if(r.status!==200)throw Error('Canary HTTP '+r.status+' tại '+endpoint.split('?')[0]);return {response:r,started:t};}
 let value=await post('/chat/completions',{model:'cx/gpt-5.6-terra',messages:[{role:'user',content:'Reply with exactly WECAT_CANARY_OK.'}],max_tokens:32,stream:false});
 const text=await value.response.text();if(!text.includes('WECAT_CANARY_OK'))throw Error('Chat canary thiếu kết quả mong đợi');checks.push({name:'chat',status:200,elapsedMs:Date.now()-value.started});
 const png='data:image/png;base64,'+referencePng().toString('base64');
 value=await post('/images/generations?response_format=binary',{model:'cx/gpt-5.6-luna-image',prompt:'A minimal white image with a small centered blue circle. Use the attached images as references.',images:[png,png],size:'1024x1024',quality:'low',image_detail:'high',output_format:'png',n:1});
 if(!value.response.headers.get('content-type')?.startsWith('image/png'))throw Error('Image canary sai Content-Type');
 const reader=value.response.body.getReader();const buffers=[];let length=0;
 for(;;){const {done,value:part}=await reader.read();if(done)break;length+=part.length;if(length>20*1024*1024){await reader.cancel();throw Error('Image canary vượt 20 MiB')}buffers.push(Buffer.from(part));}
 const dimensions=verifyPng(Buffer.concat(buffers));if(dimensions.width<64||dimensions.height<64)throw Error('Image canary kích thước bất thường');
 checks.push({name:'image-with-two-references',status:200,elapsedMs:Date.now()-value.started,bytes:length,...dimensions});
 return {schema:1,target,status:'passed',checkedAt:new Date().toISOString(),checks,realProviderCalls:2};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const flag=process.argv.includes('--allow-live');const baseUrl=process.env.WECAT_CANARY_BASE_URL,apiKey=process.env.WECAT_CANARY_API_KEY;
 liveCanary({baseUrl,apiKey,allowLive:flag,target:process.env.WECAT_CANARY_TARGET||'primary'}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exit(1)});
}
