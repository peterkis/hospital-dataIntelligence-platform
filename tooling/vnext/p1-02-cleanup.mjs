import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {readReceipt,resolveTarget,root,peer,quote} from './lineage.mjs';
import {dropTemporary} from './fresh.mjs';
const reviewMode=process.env.GITHUB_ACTIONS==='true'&&Boolean(process.env.HDIP_REVIEW_CI_ADMIN_URL);
const reviewTransport=reviewMode?await import('./review-ci-database.mjs'):null;
const transport={resolveTarget:reviewTransport?.resolveTarget??resolveTarget,peer:reviewTransport?.peer??peer};
const receiptArgument=path=>{
 const absolute=resolve(path);if(existsSync(absolute))return absolute;
 if(/\.json$/iu.test(path)){const canonical=resolve(path.replace(/\.json$/iu,'.json'));if(existsSync(canonical))return canonical;}
 return path;
};
for(const requested of process.argv.slice(2)){
 const path=receiptArgument(requested),r=readReceipt(path);
 if(r.taskId!=='P1-02'||r.purpose!=='TEMPORARY_VALIDATION'||r.lineage!=='HDIP-MC-VNEXT'||r.owner!=='hdi_prototype'||r.distro!=='Anolis-8.9-HDI-POC'||r.port!==55434||!/^hdi_mc_vnext_[a-f0-9]{16}$/u.test(r.name)||!/^\d+$/u.test(r.oid)||!/^[-a-f0-9]{36}$/u.test(r.requestId))throw new Error('DISPOSAL_NOT_AUTHORIZED');
 if(!reviewMode)transport.resolveTarget(r);
 const canonical=resolve(root,'.runtime/vnext/fresh',r.name+'.json');
 if(JSON.stringify(readReceipt(canonical))!==JSON.stringify(r))throw new Error('DISPOSAL_NOT_AUTHORIZED');
 const marker=resolve(root,'.runtime/vnext/fresh',r.name+'.disposed.json');
 if(existsSync(marker)){
  const disposed=readReceipt(marker);
  if(disposed.name!==r.name||disposed.oid!==r.oid||disposed.disposed!==true)throw new Error('DISPOSAL_NOT_AUTHORIZED');
  if(transport.peer('postgres',`SELECT count(*) FROM pg_database WHERE datname=${quote(r.name)} AND oid::text=${quote(r.oid)};`)!=='0')throw new Error('DISPOSAL_NOT_CONFIRMED');
 }else{if(reviewMode)transport.resolveTarget(r);dropTemporary(r,transport);}
 console.log(JSON.stringify({status:'OWNED_TEMPORARY_CLEANED',database:r.name,oid:r.oid}));
}
