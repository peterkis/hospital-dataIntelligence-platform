import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {operatingCodeSet} from './operating-fixture.js';
const catalog=await openCatalog(process.env['VNEXT_VALIDATION_OWNER_URL']!,new LocalSyntheticKeyProvider());
try{const source=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED')!;const manual=await operatingCodeSet(catalog,source.versionId);console.log(JSON.stringify({status:'PREFIX_MANUAL_CONTRACT_PUBLISHED',contractId:manual.reference.contractId}));}finally{await catalog.close();}
