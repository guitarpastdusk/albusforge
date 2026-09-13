import { request } from "node:http";
import { randomUUID } from "node:crypto";
import { expect,it,vi } from "vitest";
import type { LlmResponse } from "@albusforge/llm";
import { buildApp } from "./app";
const q={request_id:randomUUID(),actor_id:randomUUID(),tenant_id:randomUUID(),device_id:randomUUID(),question:"maximum?",channel:"temperature",from:"2026-09-13T00:00:00Z",to:"2026-09-13T01:00:00Z"};
it("cancels a post-body disconnect during the model and preserves normal completed responses",async()=>{
  const signals:AbortSignal[]=[];
  const app=buildApp({concurrency:1,deadlineMs:10000,maxTokens:512,model:"claude-haiku-4-5",write:()=>{},ping:async()=>{},
    store:{reserve:async()=>{},started:async()=>{},finish:async()=>{},evidence:async()=>({from:q.from,to:q.to,unit:"C",count:0,min:null,max:null,mean:null,latest:null})},
    provider:{name:"anthropic",create:async(_q,{signal})=>{
      signals.push(signal!);
      if(signals.length===1)return new Promise(()=>{});
      return {model:"claude-haiku-4-5",stop_reason:"end_turn",content:[{type:"text",text:'{"intent":"max"}'}],usage:{input_tokens:1,output_tokens:1}} as unknown as LlmResponse;
    }}});
  await app.listen({host:"127.0.0.1",port:0});
  const caller=request(app.listeningOrigin+'/v1/ask',{method:'POST',headers:{'content-type':'application/json'}});
  caller.on('error',()=>{});
  try {
    caller.end(JSON.stringify(q));await vi.waitFor(()=>expect(signals).toHaveLength(1));
    caller.destroy();await vi.waitFor(()=>expect(signals[0]!.aborted).toBe(true));
    const completed=await fetch(app.listeningOrigin+'/v1/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...q,request_id:randomUUID()})});
    expect(completed.status).toBe(200);await completed.text();
    expect(signals).toHaveLength(2);expect(signals[1]!.aborted).toBe(false);
  } finally {caller.destroy();await app.close();}
});
