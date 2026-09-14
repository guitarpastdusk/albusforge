import Fastify from 'fastify';
import { afterEach, expect, it } from 'vitest';
import { observationEvents } from './observation-events.js';
const apps:ReturnType<typeof Fastify>[]=[];
afterEach(async()=>{await Promise.all(apps.splice(0).map(app=>app.close()));});
it('records confirmed acceptance after disconnect without duplicating the request event',async()=>{
 const app=Fastify();apps.push(app);const logs:Record<string,unknown>[]=[];const events=observationEvents(app,e=>logs.push(e));
 let start!:()=>void,release!:()=>void,finish!:()=>void;
 const started=new Promise<void>(resolve=>{start=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),done=new Promise<void>(resolve=>{finish=resolve;});
 app.post('/upload',async(req,reply)=>{start();await events.storage(req,()=>gate);events.accept(req,123);finish();return reply.code(201).send({ok:true});});
 const origin=await app.listen({host:'127.0.0.1',port:0});const controller=new AbortController();
 const request=fetch(origin+'/upload',{method:'POST',signal:controller.signal}).catch(()=>{});await started;controller.abort();await request;
 for(let i=0;i<50&&!logs.length;i++)await new Promise(resolve=>setTimeout(resolve,2));
 release();await done;
 expect(logs.filter(e=>e.event==='observation_upload')).toHaveLength(1);
 expect(logs.find(e=>e.event==='observation_upload')).toMatchObject({status:499,reason:'client_aborted',accepted_bytes:0});
 expect(logs.filter(e=>e.event==='observation_accepted')).toEqual([{severity:'INFO',event:'observation_accepted',accepted_bytes:123}]);
});
it('sanitizes arbitrary failure strings and isolates logging failures',async()=>{
 const app=Fastify();apps.push(app);const logs:Record<string,unknown>[]=[];const events=observationEvents(app,e=>logs.push(e));
 app.get('/bad',async(req,reply)=>{events.reject(req,'secret device/token/key');return reply.code(503).send({ok:false});});
 expect((await app.inject({url:'/bad'})).statusCode).toBe(503);expect(logs[0]).toMatchObject({reason:'storage_unavailable'});expect(JSON.stringify(logs)).not.toContain('secret');
 const second=Fastify();apps.push(second);const secondEvents=observationEvents(second,()=>{throw Error('logger');});
 second.get('/ok',async(req,reply)=>{secondEvents.accept(req,12);return reply.code(201).send({ok:true});});
 expect((await second.inject({url:'/ok'})).statusCode).toBe(201);
});
