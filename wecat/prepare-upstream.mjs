import fs from 'node:fs';
import { run } from './release.mjs';
const ref=process.argv[2]||'master';
if(!/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(ref))throw Error('Upstream ref không hợp lệ');
if(run('git',['status','--porcelain']))throw Error('Working tree có thay đổi; commit hoặc dùng worktree riêng trước');
const remotes=run('git',['remote']);if(!remotes.split('\n').includes('upstream'))throw Error('Thiếu remote upstream');
if(run('git',['remote','get-url','upstream'])!=='https://github.com/decolua/9router.git')throw Error('Remote upstream không đúng nguồn');
run('git',['fetch','upstream',ref]);const sha=run('git',['rev-parse','FETCH_HEAD']);
const branch='wecat/upstream-'+sha.slice(0,12);run('git',['switch','-c',branch]);
try{run('git',['merge','--no-ff','--no-commit',sha]);}catch{throw Error('Merge có conflict: giữ nguyên để review, không tự reset hay đẩy lên master');}
console.log('Candidate branch: '+branch+'\nUpstream commit: '+sha+'\nReview manifest, lockfile, baseline và chạy node wecat/check.mjs sau khi commit. Không tự push/deploy.');
