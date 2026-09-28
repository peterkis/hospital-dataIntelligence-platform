import {test,expect} from 'vitest';
import {validateORG04} from '../../apps/governance-api/src/modules/department-master/index.js';

test('closed ORG04 input rejects campus and parent instead of dropping fields',()=>{
 expect(()=>validateORG04({campus:'NORTH',parent:'ROOT'})).toThrow('CLOSED_INPUT_REQUIRED');
});
