import fs from 'node:fs';
import { assertReceipt, hashes, run } from './release.mjs';
const file=process.argv[2]||'wecat/.reports/receipt.json';const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
const commit=run('git',['rev-parse','HEAD']);const image=JSON.parse(run('docker',['image','inspect',receipt.image]))[0];
if(image.Config.Labels['org.opencontainers.image.revision']!==commit)throw Error('OCI revision khác checkout');
assertReceipt(receipt,{commit,imageId:image.Id,lockHashes:hashes()});console.log('receipt-bound-to-commit-and-image');
