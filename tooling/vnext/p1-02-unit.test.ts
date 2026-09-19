import {predecessorTables} from './p1-02-preservation.mjs';
import {test,expect} from 'vitest';
import {Check} from 'typebox/value';
import {CampusReadSchema,CampusListSchema,Target} from '../../apps/governance-api/src/modules/organization-master/campus/contracts.js';
import Fastify from 'fastify';
import {registerCampusRoutes} from '../../apps/governance-api/src/platform/fastify/vnext-campus-routes.js';
const id='11111111-1111-4111-8111-111111111111';
test('closed public references reject identity and recorded-time injection',()=>{
 expect(Check(Target,{owner:'organization-master/campus',id,expectedVersion:'1'})).toBe(true);
 expect(Check(Target,{owner:'organization-master',id,expectedVersion:'1'})).toBe(false);
 expect(Check(CampusReadSchema,{id,actor:'reviewer'})).toBe(false);
 expect(Check(CampusListSchema,{limit:101})).toBe(false);
});
test('unwired campus API fails closed and exposes no success placeholder',async()=>{
 const app=Fastify();registerCampusRoutes(app);app.setErrorHandler((error,_request,reply)=>reply.code(503).send({code:error instanceof Error?error.message:undefined,message:'Blocked'}));try{const response=await app.inject({method:'POST',url:'/api/vnext/campuses/query',payload:{id}});expect(response.statusCode).toBe(503);expect(response.json().code).toBe('BLOCKED_DEPENDENCY');}finally{await app.close();}
});

test('deployment preservation separates the append-only migration ledger from prior business data',()=>{
 expect(predecessorTables(['vnext_control.migration','vnext_control.audit','organization_master.input'])).toEqual(['vnext_control.audit','organization_master.input']);
});
