import {unzip} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {textWorkbook,zipText} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
export function organizationWorkbook(tables:Record<string,string[][]>):Buffer{
 const files=Object.fromEntries(unzip(textWorkbook([['x']])));delete files['xl/worksheets/sheet1.xml'];let sheets='',relationships='',types='';
 Object.entries(tables).forEach(([name,rows],i)=>{const part='worksheets/sheet'+(9-i)+'.xml';files['xl/'+part]=Object.fromEntries(unzip(textWorkbook(rows)))['xl/worksheets/sheet1.xml']!;sheets+=`<sheet name="${name}" sheetId="${i+1}" r:id="part${i}"/>`;relationships+=`<Relationship Id="part${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${part}"/>`;types+=`<Override PartName="/xl/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;});
 files['xl/workbook.xml']=files['xl/workbook.xml']!.replace(/<sheets>.*<\/sheets>/,`<sheets>${sheets}</sheets>`);files['xl/_rels/workbook.xml.rels']=`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;files['[Content_Types].xml']=files['[Content_Types].xml']!.replace(/<Override PartName="\/xl\/worksheets\/sheet1.xml"[^>]*\/>/,types);return zipText(files);
}
