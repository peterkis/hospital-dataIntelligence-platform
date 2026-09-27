import {Children,isValidElement,type ReactNode,type ComponentProps} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect,vi} from 'vitest';
import {BundleRowAdoptionFields,BundleLicenseIntentField,BundleLicenseTargetField,bundleRowSourceVersions,bundleRowIntentPatch,bundleRowTargetPatch,bundleLicenseIntentPatch,bundleLicenseSelected,type BundleSourceContract} from '../../apps/admin-web/src/vnext/workspace-bundle-row-fields.js';
import {WorkspaceLicenseSelection} from '../../apps/admin-web/src/vnext/workspace-reference-fields.js';
import {WorkspaceLicenseDependencyOptions} from '../../apps/admin-web/src/vnext/workspace-license-dependencies.js';

type Row=Record<string,unknown>;
type Control={children?:ReactNode;value?:string;checked?:boolean;disabled?:boolean;onChange?:(event:{target:{value:string}})=>void;onClick?:()=>void};
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const datasets=['ORG01','ORG02','ORG03'] as const;
const contracts:BundleSourceContract[]=datasets.map((dataset,index)=>({dataset,id:id(index+1),versionId:id(index+11),profile:'CORE',status:'PUBLISHED',definition:{templateVersion:dataset+'_BUNDLE_CORE_V1',sourceVersionId:id(index+21)}}));
const bindings=contracts.map(contract=>({dataset:contract.dataset,contractId:contract.id,contractVersionId:contract.versionId}));
const target={owner:'organization-master' as const,id:id(40),expectedVersion:'3'};
const licenseTarget={owner:'organization-master/license' as const,id:id(41),version:'2',versionId:id(42)};
const revision:Row={dataset:'ORG01',row:2,intent:'REVISE',target,governanceScope:'NORTH',sourceVersionId:id(21),license:{intent:'REVISE',target:licenseTarget,namespace:'DEMO',authority:'DEMO office',evidence:id(43),endKind:'FINITE'},registration:{creditCodeStatus:'NOT_APPLICABLE',evidence:id(43)}};
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
function controls(node:ReactNode,type:string):Control[]{
 return Children.toArray(node).flatMap(child=>isValidElement<Control>(child)?[...(child.type===type?[child.props]:[]),...controls(child.props.children,type)]:[]);
}
function picker(node:ReactNode):ComponentProps<typeof WorkspaceLicenseSelection>{
 for(const child of Children.toArray(node))if(isValidElement<ComponentProps<typeof WorkspaceLicenseSelection>&{children?:ReactNode}>(child)){
  if(child.type===WorkspaceLicenseSelection)return child.props;
  if(child.props.children){try{return picker(child.props.children);}catch{ /* Continue to sibling controls. */ }}
 }
 throw new Error('LICENSE_PICKER_MISSING');
}
const adoption=(dataset:string,current:Row,onChange:(patch:Row)=>void=vi.fn(),disabled=false)=>BundleRowAdoptionFields({dataset,current,bindings,contracts,disabled,onChange});

for(const [index,dataset] of datasets.entries())test(`${dataset} only offers its exact bound source and rejects another sheet's event`,()=>{
 const onChange=vi.fn(),node=adoption(dataset,{},onChange),source=controls(node,'select')[2]!;
 const html=renderToStaticMarkup(node),expected=id(index+21);
 expect(bundleRowSourceVersions(dataset,bindings,[...contracts].reverse())).toEqual([expected]);
 for(const other of contracts.filter(contract=>contract.dataset!==dataset))expect(html).not.toContain(other.definition.sourceVersionId);
 source.onChange!({target:{value:id(((index+1)%3)+21)}});expect(onChange).not.toHaveBeenCalled();
 source.onChange!({target:{value:expected}});expect(onChange).toHaveBeenLastCalledWith({sourceVersionId:expected});
 source.onChange!({target:{value:''}});expect(onChange).toHaveBeenLastCalledWith({sourceVersionId:undefined});
});
test('missing, duplicate, wrong identity, unpublished and non-file bindings fail closed',()=>{
 const contract=contracts[0]!,binding=bindings[0]!;
 for(const rows of [[],[...bindings,binding],bindings.map(b=>b.dataset==='ORG01'?{...b,contractId:id(90)}:b),bindings.map(b=>b.dataset==='ORG01'?{...b,contractVersionId:id(91)}:b)])expect(bundleRowSourceVersions('ORG01',rows,contracts)).toEqual([]);
 for(const patch of [{dataset:'ORG02'},{status:'DRAFT'},{definition:{...contract.definition,templateVersion:'ORG01_MANUAL_CORE_V1'}},{definition:{...contract.definition,sourceVersionId:undefined}}]){
  expect(bundleRowSourceVersions('ORG01',bindings,[{...contract,...patch} as BundleSourceContract,...contracts.slice(1)])).toEqual([]);
 }
 expect(bundleRowSourceVersions('ORG01',bindings,[...contracts,contract])).toEqual([]);
});
test('a shared source remains available once per sheet and stale saved choices remain visible without implicit mutation',()=>{
 const shared=contracts.map(contract=>({...contract,definition:{...contract.definition,sourceVersionId:id(21)}}));
 for(const dataset of datasets)expect(bundleRowSourceVersions(dataset,bindings,shared)).toEqual([id(21)]);
 const onChange=vi.fn(),node=adoption('ORG01',{sourceVersionId:id(22)},onChange);
 expect(controls(node,'select')[2]!.value).toBe(id(22));
 expect(controls(node,'option').find(option=>option.value===id(22))).toMatchObject({disabled:true});
 expect(renderToStaticMarkup(node)).toContain('原清单来源不属于本行契约');expect(onChange).not.toHaveBeenCalled();
});
for(const dataset of datasets)test(`${dataset} REVISE to CREATE clears the hidden target in one real control callback`,()=>{
 const current={...revision,dataset},onChange=vi.fn();
 controls(adoption(dataset,current,onChange),'select')[0]!.onChange!({target:{value:'CREATE'}});
 expect(onChange).toHaveBeenCalledTimes(1);
 const next=wire({...current,...onChange.mock.calls[0]![0]});
 expect(next).toMatchObject({intent:'CREATE',governanceScope:'NORTH',sourceVersionId:id(21),registration:revision['registration']});
 expect(next).not.toHaveProperty('target');expect(next['license']).not.toHaveProperty('target');expect(next['license']).not.toHaveProperty('intent');
 expect(next['license']).toMatchObject({namespace:'DEMO',authority:'DEMO office',evidence:id(43),endKind:'FINITE'});
 expect(revision).toHaveProperty('target.id',id(40));
});
test('clearing row intent clears targets while REVISE preserves an existing explicit choice',()=>{
 expect(bundleRowIntentPatch(revision,'REVISE')).toEqual({intent:'REVISE'});
 const next=wire({...revision,...bundleRowIntentPatch(revision,'')});
 expect(next).not.toHaveProperty('intent');expect(next).not.toHaveProperty('target');
});
test('changing or clearing the parent subject invalidates its license target without erasing other fields',()=>{
 for(const nextTarget of [undefined,{...target,id:id(49)}]){
  const next=wire({...revision,...bundleRowTargetPatch(revision,nextTarget)});
  expect(next['license']).not.toHaveProperty('target');expect(next['license']).toMatchObject({intent:'REVISE',namespace:'DEMO'});
 }
 expect(bundleRowTargetPatch(revision,{...target,expectedVersion:'4'})).toEqual({target:{...target,expectedVersion:'4'}});
});
test('license REVISE to CREATE removes its own target and does not disturb the parent revision',()=>{
 const onChange=vi.fn(),node=BundleLicenseIntentField({current:revision,disabled:false,onChange});
 controls(node,'select')[0]!.onChange!({target:{value:'CREATE'}});
 const next=wire({...revision,...onChange.mock.calls[0]![0]});
 expect(next).toHaveProperty('target',target);expect(next['license']).toMatchObject({intent:'CREATE',namespace:'DEMO',endKind:'FINITE'});expect(next['license']).not.toHaveProperty('target');
 expect(wire(bundleLicenseIntentPatch(revision,'')).license).not.toHaveProperty('target');
});
test('a new subject cannot choose revision of an existing license',()=>{
 const onChange=vi.fn(),node=BundleLicenseIntentField({current:{intent:'CREATE'},disabled:false,onChange});
 expect(controls(node,'option').find(option=>option.value==='REVISE')).toMatchObject({disabled:true});
 controls(node,'select')[0]!.onChange!({target:{value:'REVISE'}});expect(onChange).not.toHaveBeenCalled();
});
test('selected license identity and version survive wire restore and are visibly checked',()=>{
 let current:Row={...revision,license:{...(revision['license'] as Row),target:undefined}};
 const onChange=(patch:Row)=>{current=wire({...current,...patch});};
 picker(BundleLicenseTargetField({actor:'maker',current,disabled:false,onChange})).onChange([licenseTarget]);
 const restored=BundleLicenseTargetField({actor:'maker',current:wire(current),disabled:false,onChange}),props=picker(restored);
 expect(props.subjectId).toBe(target.id);expect(props.selected).toEqual([{id:licenseTarget.id,version:'2'}]);
 expect(renderToStaticMarkup(restored)).toContain(licenseTarget.id);
 const row=(version:string):Parameters<typeof WorkspaceLicenseDependencyOptions>[0]['rows'][number]=>({id:licenseTarget.id,version,versionId:version==='2'?licenseTarget.versionId:id(44),revoked:false,authority:'DEMO',validFrom:'2026-01-01T00:00:00',validTo:null,endKind:'VERIFIED_UNBOUNDED',recordedAt:'2026-09-01T00:00:00'});
 const options=WorkspaceLicenseDependencyOptions({...props,rows:[row('1'),row('2')],label:row=>row.version});
 expect(controls(options,'input').map(input=>input.checked)).toEqual([false,true]);
 controls(restored,'button')[0]!.onClick!();expect(bundleLicenseSelected(current)).toEqual([]);expect(current['license']).not.toHaveProperty('target');
 expect(current['license']).toMatchObject({intent:'REVISE',namespace:'DEMO'});
});
test('an unreadable or incomplete saved target can be explicitly removed without fetched options',()=>{
 for(const current of [revision,{...revision,target:undefined},{...revision,license:{intent:'REVISE',target:{id:licenseTarget.id}}}]){
  const onChange=vi.fn(),node=BundleLicenseTargetField({actor:'maker',current,disabled:false,onChange});
  expect(controls(node,'button')[0]!.disabled).toBe(false);controls(node,'button')[0]!.onClick!();
  expect(wire({...current,...onChange.mock.calls[0]![0]})['license']).not.toHaveProperty('target');
 }
});
test('disabled row, license intent, clear and selection callbacks do not mutate saved content',()=>{
 const onChange=vi.fn();
 for(const select of controls(adoption('ORG01',revision,onChange,true),'select'))select.onChange!({target:{value:'CREATE'}});
 controls(BundleLicenseIntentField({current:revision,disabled:true,onChange}),'select')[0]!.onChange!({target:{value:'CREATE'}});
 const node=BundleLicenseTargetField({actor:'maker',current:revision,disabled:true,onChange});
 controls(node,'button')[0]!.onClick!();picker(node).onChange([licenseTarget]);expect(onChange).not.toHaveBeenCalled();
});
