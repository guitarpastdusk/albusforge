import { randomUUID } from "node:crypto";
import { describe,expect,it,vi } from "vitest";
import type { LlmProvider,LlmResponse } from "@albusforge/llm";
import { SensorAskRequest } from "@albusforge/schema";
import { answer } from "./answer";
import { buildApp } from "./app";
import { configFromEnv } from "./config";
const q = {request_id:randomUUID(),actor_id:randomUUID(),tenant_id:randomUUID(),device_id:randomUUID(),question:"What was the maximum?",channel:"temperature",from:"2026-09-13T00:00:00Z",to:"2026-09-13T01:00:00Z"};
const evidence = {from:q.from,to:q.to,unit:"C",count:3,min:0,max:6,mean:3,latest:{t:q.from,v:0}};
function options(content = '{"intent":"max"}') {
  const response = {model:"claude-haiku-4-5",stop_reason:"end_turn",content:[{type:"text",text:content}],usage:{input_tokens:100,output_tokens:10}} as unknown as LlmResponse;
  const provider = {name:"anthropic",create:vi.fn(async () => response)} satisfies LlmProvider;
  const store = {evidence:vi.fn(async () => evidence),reserve:vi.fn(async () => {}),started:vi.fn(async () => {}),finish:vi.fn(async () => {})};
  return {provider,store,model:"claude-haiku-4-5",maxTokens:512,write:vi.fn()};
}
describe("bounded sensor Ask",() => {
  it("renders only deterministic evidence and attributes usage without a build",async () => {
    const o=options(); const result=await answer(q,o,new AbortController().signal);
    expect(result.answer).toBe("Maximum observed: 6 C."); expect(result.mode).toBe("model");
    const call=o.provider.create.mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({max_tokens:512,model:"claude-haiku-4-5"});
    expect(call[0]).not.toHaveProperty("thinking");expect(call[0]).not.toHaveProperty("fallbacks");
    expect(o.store.finish).toHaveBeenCalledWith(q,"model",expect.objectContaining({buildId:null,tenantId:q.tenant_id,inputTokens:100}),expect.any(AbortSignal));
    const log=JSON.parse(o.write.mock.calls[0]![0]); expect(log).toMatchObject({stage:"ask",tenant_id:q.tenant_id,actor_id:q.actor_id,device_id:q.device_id,request_id:q.request_id});
    expect(JSON.stringify(log)).not.toContain(q.question);
  });
  it.each(['{"intent":"max","answer":"999 secrets"}','{"intent":"arbitrary_sql"}',"not json"])("falls back safely on invalid model output %s",async (content) => {
    const result=await answer(q,options(content),new AbortController().signal);
    expect(result.mode).toBe("evidence_only");expect(result.answer).not.toContain("999");expect(result.answer).toContain("sample mean 3 C");
  });
  it("does not silently answer unsupported causal questions",async () => {
    expect((await answer(q,options('{"intent":"unsupported"}'),new AbortController().signal)).answer).toContain("Please ask one of those questions");
  });
  it("returns evidence on provider failures and calls once",async () => {
    const o=options();o.provider.create.mockRejectedValue(new Error("SECRET request"));
    expect((await answer(q,o,new AbortController().signal)).mode).toBe("evidence_only");
    expect(o.provider.create).toHaveBeenCalledTimes(1);expect(JSON.parse(o.write.mock.calls[0]![0])).toMatchObject({event:"ask_usage_unknown"});
  });
  it("never calls the provider before durable authorization/quota reservation",async () => {
    const o=options();o.store.reserve.mockRejectedValue(new Error("quota"));
    await expect(answer(q,o,new AbortController().signal)).rejects.toThrow("quota");expect(o.provider.create).not.toHaveBeenCalled();
  });
  it("distinguishes no readings from zero",async () => {
    const o=options('{"intent":"latest"}'); expect((await answer(q,o,new AbortController().signal)).answer).toContain("0 C");
    o.store.evidence.mockResolvedValue({...evidence,count:0,min:null,max:null,mean:null,latest:null} as never);
    expect((await answer(q,o,new AbortController().signal)).answer).toContain("no accepted readings");
  });
  it("validates exact scoped input and bounded windows",() => {
    for(const change of [{tenant_id:"x"},{question:"x".repeat(2001)},{to:q.from},{channel:"x' OR 1=1"},{from:"2020-01-01T00:00:00Z"},{sql:"select *"}])
      expect(SensorAskRequest.safeParse({...q,...change}).success).toBe(false);
  });
  it("limits process concurrency and sanitizes failures",async () => {
    const o=options();let release!:()=>void;const wait=new Promise<void>((resolve)=>{release=resolve;});
    o.store.evidence.mockImplementation(async()=>{await wait;return evidence;});
    const app=buildApp({...o,concurrency:1,deadlineMs:1000,ping:async()=>{}});
    const first=app.inject({method:"POST",url:"/v1/ask",payload:q});
    const pending=Promise.resolve(first);await vi.waitFor(()=>expect(o.store.evidence).toHaveBeenCalled());
    const second=await app.inject({method:"POST",url:"/v1/ask",payload:q});expect(second.statusCode).toBe(429);
    release();expect((await pending).statusCode).toBe(200);
    o.store.evidence.mockRejectedValue(new Error("PRIVATE DB secret"));
    const failed=await app.inject({method:"POST",url:"/v1/ask",payload:q});expect(failed.statusCode).toBe(503);expect(failed.body).not.toContain("PRIVATE");
    await app.close();
  });
  it("fails closed on paid configuration outside the allowed small route",() => {
    expect(()=>configFromEnv({ASK_MODEL_ENABLED:"true",LLM_MODEL:"claude-opus-5",ANTHROPIC_API_KEY:"secret"})).toThrow("Invalid Ask configuration");
    expect(()=>configFromEnv({ASK_MODEL_ENABLED:"true",LLM_MODEL:"claude-haiku-4-5"})).toThrow("Invalid Ask configuration");
  });
});
it("does not retain capacity when a provider ignores abort",async()=>{
  const o=options();o.provider.create.mockImplementation(()=>new Promise(()=>{}));
  const app=buildApp({...o,concurrency:1,deadlineMs:20,ping:async()=>{}});
  const request=()=>app.inject({method:"POST",url:"/v1/ask",payload:q});
  expect((await request()).statusCode).toBe(200); // injected store accepts completion; real SQL enforces expired signal.
  expect((await request()).statusCode).toBe(200);
  await app.close();
});
it("keeps liveness independent from readiness and rejects invalid/oversized bodies",async()=>{
  const o=options();const app=buildApp({...o,concurrency:1,deadlineMs:1000,ping:async()=>{throw new Error("DB password");}});
  expect((await app.inject('/healthz')).statusCode).toBe(200);expect((await app.inject('/readyz')).statusCode).toBe(503);
  for(const payload of [{...q,actor_id:"invalid"},{...q,question:"x".repeat(17000)}]) {
    const reply=await app.inject({method:"POST",url:"/v1/ask",payload});expect(reply.statusCode).toBe(400);expect(reply.headers['cache-control']).toBe('private, no-store');
  }
  expect(o.provider.create).not.toHaveBeenCalled();await app.close();
});
