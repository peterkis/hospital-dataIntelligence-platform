"""Vendor immutable local sources and compile metadata; never approve them."""
import csv, hashlib, json, pathlib, sys

root = pathlib.Path(__file__).resolve().parents[2]
source = pathlib.Path(sys.argv[1])
output_root = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'db/vnext/sources'
destination = output_root / 'package-v2'
paths = [
    'inputs/dataset-v2/catalog.ORG-PER.json', 'inputs/dataset-v2/models.ORG-PER.json',
    'inputs/dataset-v2/supporting-reference-models.json', 'inputs/dataset-v2/polymorphic_reference_registry.json',
    'maps/field-routing.csv', 'maps/external-reference-disposition.json', 'machine/quality-gates.json',
    'docs/02-target-domain-architecture.md', 'tasks/P0/P0-01.prompt.md', 'common/ENGINEERING_CONTRACT.md',
]
paths += [str(p.relative_to(source)).replace('\\', '/') for directory in ['datasets', 'contracts/drafts'] for p in sorted((source/directory).iterdir()) if p.is_file()]
manifest = []
for name in paths:
    data = (source/name).read_bytes()
    target = destination/name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        assert target.read_bytes() == data, 'SOURCE_DRIFT'
    else:
        with target.open('xb') as stream: stream.write(data)
    manifest.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest()})
def load(name): return json.loads((destination/name).read_text(encoding='utf-8'))
catalog = load('inputs/dataset-v2/catalog.ORG-PER.json')
models = load('inputs/dataset-v2/models.ORG-PER.json')
support = load('inputs/dataset-v2/supporting-reference-models.json')
poly = load('inputs/dataset-v2/polymorphic_reference_registry.json')
external = load('maps/external-reference-disposition.json')
routes = list(csv.DictReader((destination/'maps/field-routing.csv').open(encoding='utf-8-sig', newline='')))
route_map = {(r['dataset_id'],r['field_code']): r for r in routes}
assert len(routes) == len(route_map) == 866
domains = [
 ('GOV', '治理控制与数据质量', []),
 ('SUBJECT', '组织主体与院区', ['ORG01','ORG02','ORG03']),
 ('DEPARTMENT', '科室与多视图', ['ORG04','ORG05','ORG06','ORG22','ORG23','ORG26','ORG27']),
 ('CARE', '业务单元及护理服务组织', ['ORG07','ORG08','ORG09','ORG10','ORG11','ORG14','ORG16','ORG17']),
 ('LOCATION', '物理空间', ['ORG12','ORG13']),
 ('REFERENCE', '监管核算统计', ['ORG18','ORG19','ORG20','ORG21']),
 ('BED', '床位资源及口径快照', ['ORG24','ORG25']),
 ('PERSON', '人员任用任职', ['PER01','PER02','PER04','PER06','PER15','PER21','PER24']),
 ('PROFESSIONAL', '岗位医疗组及专业资格', ['ORG15','PER05','PER07','PER08','PER09','PER10','PER11','PER12','PER13','PER14','PER16','PER25']),
 ('IAM', '数字身份与访问', ['PER17','PER18','PER19','PER20','PER26']),
 ('HR', '受限HR与经历', ['PER03','PER22','PER23']),
]
owner = {code: domain for domain, _, codes in domains for code in codes}
assert set(owner) == set(models) and len(catalog) == 53
records = []
for entry in catalog:
    code = entry['id']; model = models[code]
    assert entry['approval_status'] == '待院方确认'
    fields, dependencies = [], []
    for index, field in enumerate(model['fields']):
        route = route_map[(code, field['code'])]
        pointer = f"/{code}/fields/{index}"
        assert route['source_json_pointer'] == pointer
        assert route['source_ref'] == field['ref'] and route['source_required'] == field['required']
        fields.append({'original': field, 'pointer': pointer, 'routing': route})
        ref = field['ref']
        if not ref: continue
        dependency = {'field': field['code'], 'ref': ref, 'ownerTasks': json.loads(route['required_owner_tasks']), 'implementationTask': route['implementation_task'], 'status': 'DECLARED_NOT_READY'}
        if ref.startswith('enum:'):
            dependency['kind'] = 'STANDARD_REFERENCE'
        elif ref.startswith('poly:'):
            definition = poly[ref[5:]]
            discriminator = definition['field_overrides'].get(code+'.'+field['code'], definition['default_discriminator'])
            assert discriminator in {f['code'] for f in model['fields']}, 'MISSING_DISCRIMINATOR'
            dependency.update(kind='POLYMORPHIC', discriminator=discriminator, targets=definition['mapping'])
        else:
            target, target_field = ref.split('.')
            assert target in models or target in support, 'UNKNOWN_TARGET'
            assert target_field in {f['code'] for f in (models | support)[target]['fields']}, 'UNKNOWN_TARGET_FIELD'
            dependency['kind'] = 'EXTERNAL_REFERENCE' if target in support else ('REQUIRED_TARGET' if field['required']=='R' else 'DEFERRED_RELATION')
        if ref.startswith('poly:') or ('.' in ref and ref.split('.')[0] in support):
            disposition = next((e for e in external if e['reference']==ref and code+'.'+field['code'] in e['fields']), None)
            assert disposition, 'EXTERNAL_DISPOSITION_REQUIRED'
            dependency['disposition'] = disposition
        dependencies.append(dependency)
    records.append({'code': code, 'domain': owner[code], 'original': entry, 'model': {k:v for k,v in model.items() if k!='fields'}, 'fields':fields, 'dependencies':dependencies,
                    'adopted': {'name':entry['name'], 'explanation':'仅登记来源元数据；采用解释待复核'}, 'readiness':'METADATA_ONLY', 'adapter':'NOT_READY'})
assert sum(len(r['fields']) for r in records if r['code'].startswith('ORG'))==419
assert sum(len(r['fields']) for r in records if r['code'].startswith('PER'))==447
output={'manifest':manifest,'domains':[{'code':c,'name':n,'datasets':d} for c,n,d in domains], 'records':records,'external':external,'supportingModels':support,'polymorphicRegistry':poly,'qualityGates':load('machine/quality-gates.json')}
encoded=(json.dumps(output, ensure_ascii=False, indent=2)+'\n').encode()
target=output_root/'catalog-metadata.json'
if target.exists(): assert target.read_bytes()==encoded, 'GENERATED_SOURCE_DRIFT'
else: target.write_bytes(encoded)
print(json.dumps({'status':'PASS','domains':11,'datasets':53,'fields':866,'sourceFiles':len(manifest),'sha256':hashlib.sha256(encoded).hexdigest()}))
