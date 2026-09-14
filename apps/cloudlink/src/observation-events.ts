import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Log } from './app.js';
const reasons = new Set(['invalid_request','unauthorized','capability_forbidden','invalid_capability_configuration','busy','invalid_metadata','unsupported_payload','attempt_limit','payload_too_large','invalid_image','digest_mismatch','ownership_changed','capability_changed','observation_conflict','observation_expired','observation_pending','timestamp_out_of_range','daily_quota','object_unavailable','object_conflict','reservation_lost','reservation_day_changed']);
interface EventState { start:number; storageMs:number; storageStart?:number; acceptedBytes:number; reason?:string; emitted:boolean }
/** Only fixed reason/status labels and bounded numeric values; never request data. */
export function observationEvents(app:FastifyInstance,log:Log) {
 const states=new WeakMap<FastifyRequest,EventState>();
 const emit=(request:FastifyRequest,status:number)=>{
  const s=states.get(request);if(!s||s.emitted)return;s.emitted=true;
  const elapsed=performance.now();
  const outcome=status===201?'new':status===200?'duplicate':'rejected';
  try{log({severity:status>=500?'WARNING':'INFO',event:'observation_upload',status,outcome,reason:outcome==='rejected'?(s.reason??(status===499?'client_aborted':status>=500?'storage_unavailable':'invalid_request')):'none',accepted_bytes:status===201?s.acceptedBytes:0,request_ms:Math.max(0,Math.round(elapsed-s.start)),storage_ms:Math.max(0,Math.round(s.storageMs+(s.storageStart===undefined?0:elapsed-s.storageStart)))});}catch{/* Metrics cannot change request ownership or result. */}
 };
 app.addHook('onRequest',async(request,reply)=>{states.set(request,{start:performance.now(),storageMs:0,acceptedBytes:0,emitted:false});reply.raw.once('close',()=>{if(!reply.raw.writableFinished)emit(request,499);});});
 app.addHook('onResponse',async(request,reply)=>{emit(request,reply.statusCode);});
 return {
  reject(request:FastifyRequest,reason:string){const s=states.get(request);if(s)s.reason=reasons.has(reason)?reason:'storage_unavailable';},
  accept(request:FastifyRequest,bytes:number){const s=states.get(request);if(s)s.acceptedBytes=bytes;try{log({severity:"INFO",event:"observation_accepted",accepted_bytes:bytes});}catch{/* confirmed commit remains accepted */}},
  async storage<T>(request:FastifyRequest,run:()=>Promise<T>){const s=states.get(request);const start=performance.now();if(s)s.storageStart=start;try{return await run();}finally{if(s){s.storageMs+=performance.now()-start;delete s.storageStart;}}},
 };
}
