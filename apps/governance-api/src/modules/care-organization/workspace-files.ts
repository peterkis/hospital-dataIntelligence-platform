import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {careFileSchemas,CareFileBytesSchema,CareFileReceiptSchema,type CareFileReceipt,type CareSavedFile} from './workspace-file-contracts.js';
import type {CareWorkspaceKind} from './workspace-contracts.js';
import type {CareValidationPorts} from './validation-owner.js';

export async function receiveWorkspaceFile(ports:CareValidationPorts,actor:string,kind:CareWorkspaceKind,file:CareSavedFile):Promise<CareFileReceipt>{
 if(kind==='LIFECYCLE'||!ports[kind])throw new Error('BLOCKED_DEPENDENCY');
 const schema=Type.Object({input:careFileSchemas[kind],contentBase64:CareFileBytesSchema},{additionalProperties:false});
 if(!Check(schema,file.body))throw new Error('CLOSED_INPUT_REQUIRED');
 const bytes=Buffer.from(file.body.contentBase64,'base64');if(bytes.length<1||bytes.length>1048576)throw new Error('CLOSED_INPUT_REQUIRED');
 try{
  const body=file.body.input;let result;
  switch(kind){
   case 'UNIT':result=await ports.UNIT!.receiveFile(actor,body as Static<typeof careFileSchemas.UNIT>,bytes);break;
   case 'NURSING':result=await ports.NURSING!.receiveFile(actor,body as Static<typeof careFileSchemas.NURSING>,bytes);break;
   case 'WARD':result=await ports.WARD!.receiveFile(actor,body as Static<typeof careFileSchemas.WARD>,bytes);break;
   case 'UNIT_WARD':result=await ports.UNIT_WARD!.receiveFile(actor,body as Static<typeof careFileSchemas.UNIT_WARD>,bytes);break;
   case 'WARD_NURSING':result=await ports.WARD_NURSING!.receiveFile(actor,body as Static<typeof careFileSchemas.WARD_NURSING>,bytes);break;
   case 'CAPABILITY':result=await ports.CAPABILITY!.receiveFile(actor,body as Static<typeof careFileSchemas.CAPABILITY>,bytes);break;
   case 'PERMISSION':result=await ports.PERMISSION!.receiveFile(actor,body as Static<typeof careFileSchemas.PERMISSION>,bytes);break;
   case 'LOCATION':result=await ports.LOCATION!.receiveFile(actor,body as Static<typeof careFileSchemas.LOCATION>,bytes);break;
   case 'LOCATION_USE':result=await ports.LOCATION_USE!.receiveFile(actor,body as Static<typeof careFileSchemas.LOCATION_USE>,bytes);break;
  }
  const job=body['job'] as {input:{format:string}};
  const value={jobId:result.jobId,revisionId:result.revisionId,sourceArtifactId:result.sourceArtifactId,structuralStatus:result.structuralStatus,input:result.input,issues:result.issues,worksheet:job.input.format==='XLSX'?{UNIT:'ORG07',NURSING:'ORG09',WARD:'ORG08',UNIT_WARD:'ORG10',WARD_NURSING:'ORG11',CAPABILITY:'ORG16',PERMISSION:'ORG17',LOCATION:'ORG12',LOCATION_USE:'ORG13'}[kind]:null};
  if(!Check(CareFileReceiptSchema,value))throw new Error('OWNER_RESPONSE_INVALID');return value as CareFileReceipt;
 }finally{bytes.fill(0);}
}
