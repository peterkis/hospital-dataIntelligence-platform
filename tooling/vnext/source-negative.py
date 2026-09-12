"""Synthetic metadata mutations exercise the real compiler in receipt-owned output paths."""
import csv,json,pathlib,shutil,subprocess,sys,uuid
root=pathlib.Path(__file__).resolve().parents[2]
owned=root/'.runtime/vnext'/('source-negative-'+uuid.uuid4().hex)
owned.mkdir(parents=True)
results=[]
for issue,expected in [('target','UNKNOWN_TARGET'),('field','UNKNOWN_TARGET_FIELD'),('discriminator','MISSING_DISCRIMINATOR')]:
    source=owned/issue/'source'
    shutil.copytree(root/'db/vnext/sources/package-v2',source)
    if issue in ('target','field'):
        model_path=source/'inputs/dataset-v2/models.ORG-PER.json'
        models=json.loads(model_path.read_text(encoding='utf8'))
        field=next(f for f in models['ORG07']['fields'] if f['code']=='business_owner_id')
        field['ref']='ORG99.missing' if issue=='target' else 'PER01.missing_field'
        model_path.write_text(json.dumps(models,ensure_ascii=False),encoding='utf8')
        path=source/'maps/field-routing.csv'
        rows=list(csv.DictReader(path.open(encoding='utf-8-sig',newline='')))
        for row in rows:
            if row['dataset_id']=='ORG07' and row['field_code']=='business_owner_id':row['source_ref']=field['ref']
        with path.open('w',encoding='utf8',newline='') as stream:
            writer=csv.DictWriter(stream,fieldnames=rows[0].keys());writer.writeheader();writer.writerows(rows)
    else:
        path=source/'inputs/dataset-v2/polymorphic_reference_registry.json'
        value=json.loads(path.read_text(encoding='utf8'));value['org_target']['default_discriminator']='missing_discriminator'
        path.write_text(json.dumps(value,ensure_ascii=False),encoding='utf8')
    result=subprocess.run([sys.executable,str(root/'tooling/vnext/prepare-catalog.py'),str(source),str(owned/issue/'output')],capture_output=True,text=True,encoding='utf8')
    assert result.returncode!=0 and expected in result.stderr, (issue,result.stderr[-500:])
    results.append({'issue':issue,'code':expected,'exit':result.returncode})
print(json.dumps({'status':'PASS','checks':results,'retainedSyntheticFixtures':str(owned)}))
