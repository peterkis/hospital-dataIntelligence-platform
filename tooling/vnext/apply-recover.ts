import './connection-guard.mjs';
import {finiteCoordinator} from './apply-owner-fixture.js';
const service=finiteCoordinator(process.env['VNEXT_VALIDATION_OWNER_URL']!);
try{console.log(JSON.stringify(await service.coordinator.resumeOutcome('maker',JSON.parse(process.env['APPLY_RECOVERY_REQUEST']!))));}
finally{await service.close();}
