import {test,expect} from 'vitest';
import {licenseEnd,localTime,covered} from '../../apps/governance-api/src/modules/organization-master/time.js';

test('date-only expiration excludes midnight; explicit seconds and microseconds are preserved',()=>{
 expect(licenseEnd('2027-01-02','FINITE')).toBe('2027-01-02T00:00:00.000000');
 expect(licenseEnd('2027-01-02T13:45:06.123456','FINITE')).toBe('2027-01-02T13:45:06.123456');
 expect(licenseEnd(null,'VERIFIED_UNBOUNDED')).toBe(null);
 expect(()=>licenseEnd(null,'UNKNOWN',true)).toThrow('LICENSE_END_UNKNOWN');
 for(const bad of ['2026-02-29','2026-01-01T00:00:00Z','2026-01-01T24:00:00'])expect(()=>localTime(bad)).toThrow();
});
test('full-window coverage rejects a future license, gaps and exclusive end equality',()=>{
 const spans=[{from:'2026-02-01',to:'2026-03-01'},{from:'2026-03-01',to:'2026-04-01'}];
 expect(covered(spans,'2026-02-01','2026-04-01')).toBe(true);
 expect(covered(spans,'2026-01-01','2026-04-01')).toBe(false);
 expect(covered(spans,'2026-04-01',null)).toBe(false);
 expect(covered([{from:'2026-01-01',to:'2026-02-01'},{from:'2026-03-01',to:null}],'2026-01-01',null)).toBe(false);
});
