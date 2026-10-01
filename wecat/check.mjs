import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, hashes, restoreLocks, redact, sha256 } from './release.mjs';
import { containerSmoke } from './container-smoke.mjs';
const flags=new Set(process.argv.slice(2));
const diagnostic=flags.has('--diagnostic');const noBuild=flags.has('--no-build');
const commit=run('git',['rev-parse','HEAD']);
if(!diagnostic && run('git',['status','--porcelain','--untracked-files=normal']))throw Error('Commit thay đổi trước khi phát hành receipt; dùng --diagnostic để điều tra');
fs.mkdirSync('wecat/.reports',{recursive:true});const report={schema:1,commit,status:'failed',startedAt:new Date().toISOString(),lockHashes:hashes(),checks:{},realProviderCalls:0};
const config=JSON.parse(fs.readFileSync('wecat/validation.json','utf8'));const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'wecat-gate-'));
const inherited=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/(?:key|secret|password|oauth|token)/i.test(k)));
const env={...inherited,DATA_DIR:tmp,DISABLE_BACKGROUND_TOKEN_REFRESH:'true',NEXT_TELEMETRY_DISABLED:'1'};
function check(name,cmd,args,options={}){
 const r=spawnSync(cmd,args,{encoding:'utf8',env,...options});const log=redact((r.stdout||'')+(r.stderr||''));fs.writeFileSync('wecat/.reports/'+name+'.log',log);
 report.checks[name]={status:r.status===0?'passed':'failed',exitCode:r.status};console.log(name+': '+report.checks[name].status);
 if(r.status!==0)throw Error(name+' thất bại; xem wecat/.reports/'+name+'.log');
}
try{
 if(sha256(fs.readFileSync('package.json'))!==config.packageManifestSha256||sha256(fs.readFileSync('tests/package.json'))!==config.testManifestSha256||sha256(fs.readFileSync('wecat/package.json'))!==config.toolManifestSha256)throw Error('Manifest khác baseline; review dependency và cập nhật lock trước');
 restoreLocks();
 check('ops',process.execPath,['--test','wecat/tests/ops.test.mjs']);
 check('contracts',process.execPath,['wecat/contract-check.mjs']);
 check('mutation',process.execPath,['wecat/mutation-check.mjs']);
 check('critical','./node_modules/.bin/vitest',['run','--config','../wecat/vitest.config.mjs',...config.criticalSuites,'--maxWorkers=2','--reporter=json','--outputFile=../wecat/.reports/critical-results.json'],{cwd:'tests'});
 const image='wecat-9router:candidate-'+commit;
 if(!noBuild)check('build','docker',['build','--progress=plain','-f','wecat/Dockerfile','--build-arg','APP_VERSION='+JSON.parse(fs.readFileSync('package.json')).version,'--label','org.opencontainers.image.revision='+commit,'-t',image,'.']);
 const info=JSON.parse(run('docker',['image','inspect',image]))[0];if(info.Config.Labels['org.opencontainers.image.revision']!==commit)throw Error('Docker image khác commit');
 report.image=image;report.imageId=info.Id;report.nodeImage=config.nodeImage;
 report.checks.container=await containerSmoke(image);
 report.status=diagnostic?'diagnostic':'passed';report.finishedAt=new Date().toISOString();console.log('local-gate: '+report.status);
}catch(e){report.error=redact(e.message);console.error(report.error);process.exitCode=1;
}finally{fs.writeFileSync('wecat/.reports/receipt.json',JSON.stringify(report,null,2)+'\n');fs.rmSync(tmp,{recursive:true,force:true});}
