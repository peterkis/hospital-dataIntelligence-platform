import {test,expect} from 'vitest';
import {parseBytes} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
const fields=[{code:'version_no',type:'integer'}];
test.each(['1.0','1e0','10e-1','0.001e3'])('location-use JSON native integer %s retains its exact source token and native value',token=>{
 const parsed=parseBytes(Buffer.from('[{"version_no":'+token+'}]'),'JSON',fields,'STRICT_LOCATION_USE_V1');expect(parsed.issues).toEqual([]);expect(parsed.nativeRows).toEqual([{version_no:1}]);expect(parsed.cells[0]?.value).toBe(token);
});
test.each(['1.00000000000000001','100000000000000001e-17'])('location-use JSON non-integer %s is rejected despite JavaScript rounding it to one',token=>{
 const parsed=parseBytes(Buffer.from('[{"version_no":'+token+'}]'),'JSON',fields,'STRICT_LOCATION_USE_V1');expect(parsed.issues.length).toBeGreaterThan(0);expect(parsed.cells[0]?.value).toBe(token);
});
