import {lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {parse,resolve,sep} from 'node:path';

// Reject redirected ancestors before creating any run files. The wrapper alone
// exclusively allocates the run; child/finalizer can only use that existing path.
export function evidenceRunDirectory(path,{create=false,exclusive=false}={}) {
  const absolute=resolve(path);
  const root=parse(absolute).root;
  let current=root;
  for(const part of absolute.slice(root.length).split(sep)) {
    current=resolve(current,part);
    let stat;
    try {stat=lstatSync(current);} catch(error) {if(error.code!=='ENOENT')throw error;}
    if(stat) {
      if(stat.isSymbolicLink()||!stat.isDirectory()||(exclusive&&current===absolute))throw new Error('P0_10_RUN_PATH_INVALID');
    } else {
      if(!create)throw new Error('P0_10_RUN_PATH_INVALID');
      mkdirSync(current);
      if(lstatSync(current).isSymbolicLink())throw new Error('P0_10_RUN_PATH_INVALID');
    }
  }
  const canonical=realpathSync(absolute);
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(normalize(canonical)!==normalize(absolute))throw new Error('P0_10_RUN_PATH_INVALID');
  return absolute;
}
