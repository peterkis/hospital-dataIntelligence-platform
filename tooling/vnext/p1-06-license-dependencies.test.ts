import {Children,createElement,isValidElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {test,expect,vi} from 'vitest';
import {WorkspaceLicenseDependencyOptions,licenseDependencyOptions} from '../../apps/admin-web/src/vnext/workspace-license-dependencies.js';

type Props=Parameters<typeof WorkspaceLicenseDependencyOptions>[0];
type License=Props['rows'][number];
type Control={children?:ReactNode;checked?:boolean;disabled?:boolean;onChange?:(event:{target:{checked:boolean}})=>void;onClick?:()=>void};
const row=(version:string,revoked=false,id='license-a'):License=>({id,version,versionId:id+'-'+version,revoked,authority:'DEMO',validFrom:'2026-01-01T00:00:00',validTo:null,endKind:'VERIFIED_UNBOUNDED',recordedAt:'2026-09-01T00:00:00'});
const old=row('1'),newer=row('2'),revoked=row('3',true),other=row('1',false,'license-b');
const history=[old,revoked,other,newer];
const ref=(value:License)=>({owner:'organization-master/license',id:value.id,version:value.version,versionId:value.versionId});
const props=(patch:Partial<Props>={}):Props=>({rows:history,selected:[],multiple:true,disabled:false,onChange:vi.fn(),label:value=>value.versionId,...patch});
function controls(node:ReactNode,type:string):Control[]{
 return Children.toArray(node).flatMap(child=>isValidElement<Control>(child)?[...(child.type===type?[child.props]:[]),...controls(child.props.children,type)]:[]);
}
const render=(value:Props)=>renderToStaticMarkup(createElement(WorkspaceLicenseDependencyOptions,value));

for(const multiple of [true,false])test(`${multiple?'registration checkboxes':'scope radio buttons'} render every non-revoked version but no revoked input`,()=>{
 const value=props({multiple}),element=WorkspaceLicenseDependencyOptions(value),html=render(value);
 expect(controls(element,'input')).toHaveLength(3);
 expect(html).not.toContain(revoked.versionId);
 for(const license of [old,newer,other])expect(html).toContain(license.versionId);
 expect(html.match(new RegExp(`type="${multiple?'checkbox':'radio'}"`,'g'))).toHaveLength(3);
});
test('a revoked or future-effective head does not remove older non-revoked dependency versions',()=>{
 const future={...newer,validFrom:'2035-01-01T00:00:00'},rows=Object.freeze([Object.freeze(revoked),Object.freeze(future),Object.freeze(old)]);
 expect(licenseDependencyOptions(rows)).toEqual([future,old]);
 expect(rows).toEqual([revoked,future,old]);
 expect(licenseDependencyOptions([...rows].reverse())).toEqual([old,future]);
});
test('all-revoked and empty histories expose no selectable input and explain the empty choices',()=>{
 for(const rows of [[revoked],[]]){
  const value=props({rows});expect(controls(WorkspaceLicenseDependencyOptions(value),'input')).toHaveLength(0);
  expect(render(value)).toContain('没有可选择的非撤销证照版本');
 }
});
test('multi-select rebuilding cannot carry a previously selected revoked assertion into another choice',()=>{
 const onChange=vi.fn(),value=props({selected:[old,revoked],onChange});
 const inputs=controls(WorkspaceLicenseDependencyOptions(value),'input');
 inputs[2]!.onChange!({target:{checked:true}});
 expect(onChange).toHaveBeenLastCalledWith([ref(old),ref(newer)]);
 inputs[0]!.onChange!({target:{checked:false}});
 expect(onChange).toHaveBeenLastCalledWith([]);
});
test('single selection emits the exact historical version and ignores unchecked radio events',()=>{
 const onChange=vi.fn(),value=props({multiple:false,selected:[revoked],onChange});
 const input=controls(WorkspaceLicenseDependencyOptions(value),'input')[0]!;
 input.onChange!({target:{checked:false}});expect(onChange).not.toHaveBeenCalled();
 input.onChange!({target:{checked:true}});expect(onChange).toHaveBeenCalledExactlyOnceWith([ref(old)]);
});
for(const multiple of [true,false])test(`${multiple?'multiple':'single'} restored revoked selection is reported, not silently rewritten`,()=>{
 const onChange=vi.fn(),selected=Object.freeze([revoked]),value=props({multiple,selected,onChange});
 const element=WorkspaceLicenseDependencyOptions(value);
 expect(render(value)).toContain('已选引用包含撤销记录');
 expect(onChange).not.toHaveBeenCalled();expect(selected).toEqual([revoked]);
 controls(element,'button')[0]!.onClick!();expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
});
test('explicit cleanup retains selected non-revoked historical versions',()=>{
 const onChange=vi.fn(),element=WorkspaceLicenseDependencyOptions(props({selected:[old,revoked,newer],onChange}));
 controls(element,'button')[0]!.onClick!();expect(onChange).toHaveBeenCalledExactlyOnceWith([ref(old),ref(newer)]);
});
for(const multiple of [true,false])test(`disabled ${multiple?'multiple':'single'} selection and cleanup callbacks cannot change a draft`,()=>{
 const onChange=vi.fn(),value=props({multiple,disabled:true,selected:[revoked],onChange}),element=WorkspaceLicenseDependencyOptions(value);
 for(const input of controls(element,'input')){expect(input.disabled).toBe(true);input.onChange!({target:{checked:true}});}
 for(const button of controls(element,'button')){expect(button.disabled).toBe(true);button.onClick!();}
 expect(onChange).not.toHaveBeenCalled();expect(render(value).match(/disabled=""/g)).toHaveLength(4);
});
test('selected identity matches id and version, not just a shared version number',()=>{
 const inputs=controls(WorkspaceLicenseDependencyOptions(props({selected:[old]})),'input');
 expect(inputs.map(input=>input.checked)).toEqual([true,false,false]);
});
test('the dependency filter does not claim period or end-kind qualification',()=>{
 const unknown={...old,endKind:'UNKNOWN' as const},expired={...newer,validTo:'2026-02-01T00:00:00'};
 expect(licenseDependencyOptions([unknown,revoked,expired])).toEqual([unknown,expired]);
});
