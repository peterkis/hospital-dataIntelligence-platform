export function WorkspaceMaterial({id,bytesBase64,onRead}:{id:string;bytesBase64:string;onRead:()=>void}){
 const bytes=Uint8Array.from(atob(bytesBase64),c=>c.charCodeAt(0));let text:string|null=null;
 try{const decoded=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!/[\u0000-\u0008\u000e-\u001f]/.test(decoded)&&!decoded.startsWith('%PDF-')&&!decoded.startsWith('PK'))text=decoded;}catch{/* Binary material is opened as its original bytes. */}
 function download(){const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),link=document.createElement('a');link.href=url;link.download='evidence-'+id+'.bin';link.click();URL.revokeObjectURL(url);onRead();}
 return <details onToggle={e=>{if(e.currentTarget.open&&text!==null)onRead();}}><summary>受控原材料 · {id.slice(-8)}</summary>{text===null?<><p>该材料不是纯文本。请下载原件并核对，再作独立确认。</p><button className="secondary" onClick={download}>下载受控原件进行核对</button></>:<pre>{text}</pre>}</details>;
}
