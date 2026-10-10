import {createVNextCatalogClient,type VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';
import {departmentValue} from './department-request.js';
import type {CareDataset} from './care-model.js';
type Contract=Operations['listImportContracts']['responses'][200]['content']['application/json']['items'][number];
/** Current public reader is paginated; later P3 datasets must not disappear. */
export async function loadCareContracts(actor:string,dataset:CareDataset|'',profile:'CORE'|'FULL'):Promise<Contract[]>{if(!dataset)return [];const client=createVNextCatalogClient(location.origin,actor),items:Contract[]=[];let page=1,total=0;do{const result=await departmentValue(client.GET('/api/vnext/contracts/current',{params:{query:{scope:'SYNTHETIC',dataset,profile,page}}}));total=result.total;items.push(...result.items.filter(item=>item.status==='PUBLISHED'));page++;}while((page-1)*10<total);return items;}
