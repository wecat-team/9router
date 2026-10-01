import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from './node_modules/playwright/index.mjs';
import { run, requireLocalUrl } from './release.mjs';
export async function containerSmoke(image) {
 const suffix=crypto.randomBytes(6).toString('hex'),name='wecat-smoke-'+suffix,network=name+'-net',volume=name+'-data';
 const password=crypto.randomBytes(24).toString('hex');let started=false;
 const checks=[];
 try{
  run('docker',['network','create',network]);run('docker',['volume','create',volume]);
  const info=JSON.parse(run('docker',['network','inspect',network]))[0];const gateway=info.IPAM.Config[0].Gateway;
  run('docker',['run','-d','--name',name,'--network',network,'-p','127.0.0.1::20128','-v',volume+':/app/data','-e','DATA_DIR=/app/data','-e','DISABLE_BACKGROUND_TOKEN_REFRESH=true','-e','REQUIRE_API_KEY=true','-e','JWT_SECRET='+crypto.randomBytes(32).toString('hex'),'-e','INITIAL_PASSWORD='+password,'-e','API_KEY_SECRET='+crypto.randomBytes(32).toString('hex'),'-e','MACHINE_ID_SALT='+crypto.randomBytes(32).toString('hex'),'-e','WECAT_TRUSTED_PROXY_IPS='+gateway,image]);started=true;
  const port=run('docker',['port',name,'20128/tcp']).split(':').at(-1);const base='http://127.0.0.1:'+port;requireLocalUrl(base);
  let ready=false;
  for(let i=0;i<60;i++){try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(2000)});if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,1000));}
  assert.ok(ready,'Container không healthy');checks.push({path:'/api/health',status:200});
  const loginPage=await fetch(base+'/login');assert.equal(loginPage.status,200);assert.match(await loginPage.text(),/<title>9Router/i);checks.push({path:'/login',status:200});
  const browser=await chromium.launch({headless:true,...(process.env.WECAT_CHROME_EXECUTABLE?{executablePath:process.env.WECAT_CHROME_EXECUTABLE}:{})});
  try{
   const context=await browser.newContext({viewport:{width:1280,height:800}});
   await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/login',{waitUntil:'domcontentloaded'});await page.locator('input[type=password]').waitFor({state:'visible',timeout:30000});
   await page.locator('input[type=password]').fill(password);await page.locator('button[type=submit]').click();await page.waitForURL('**/dashboard**',{timeout:30000});
   await page.goto(base+'/dashboard/providers',{waitUntil:'networkidle'});assert.equal(errors.length,0,'Browser có lỗi JavaScript');
   const providers=await context.request.get(base+'/api/providers');assert.equal(providers.status(),200);assert.deepEqual((await providers.json()).connections,[]);
   await page.screenshot({path:'wecat/.reports/dashboard.png',fullPage:true});checks.push({name:'browser-login-and-providers',status:'passed',jsErrors:0});
  }finally{await browser.close();}
  const request={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'invalid-survey/model',prompt:'offline probe'})};
  let r=await fetch(base+'/v1/images/generations',request);assert.equal(r.status,401);checks.push({path:'/v1/images/generations',auth:'missing',status:401});
  r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});assert.equal(r.status,200);assert.equal((await r.json()).success,true);
  const cookie=r.headers.get('set-cookie').split(';')[0];assert.ok(cookie.startsWith('auth_token='));checks.push({path:'/api/auth/login',status:200});
  r=await fetch(base+'/api/providers',{headers:{cookie}});assert.equal(r.status,200);assert.deepEqual((await r.json()).connections,[]);checks.push({path:'/api/providers',status:200});
  r=await fetch(base+'/api/keys',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({name:'temporary-offline-smoke'})});assert.equal(r.status,201);const key=(await r.json()).key;assert.ok(key);checks.push({path:'/api/keys',status:201});
  r=await fetch(base+'/v1/images/generations',{...request,headers:{...request.headers,authorization:'Bearer '+key}});assert.equal(r.status,400);checks.push({path:'/v1/images/generations',auth:'valid-key-invalid-model',status:400});
  const status=JSON.parse(run('docker',['inspect',name]))[0];assert.equal(status.RestartCount,0);assert.ok(status.State.Running);
  return {status:'passed',checks,realProviderCalls:0};
 }finally{
  if(started)run('docker',['rm','-f',name]);
  try{run('docker',['volume','rm',volume])}catch{}
  try{run('docker',['network','rm',network])}catch{}
 }
}
if(process.argv[1]?.endsWith('container-smoke.mjs')){
 containerSmoke(process.argv[2]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exit(1)});
}
