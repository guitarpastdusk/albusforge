import Fastify from "fastify";
import { DeviceConverseRequest, SensorAskRequest } from "@albusforge/schema";
import { answer, type AnswerOptions } from "./answer";
import { converse, type ConverseOptions } from "./converse";
import { AskError, AskQuotaError } from "./errors";
export function buildApp(options: AnswerOptions & { concurrency: number; deadlineMs: number; ping: () => Promise<void>; chat?: ConverseOptions; chatDeadlineMs?: number }) {
  const app = Fastify({ logger:false,bodyLimit:16000,requestTimeout:30000 });
  let active = 0;
  app.addHook("onRequest",async (_request,reply) => { reply.header("cache-control","private, no-store"); });
  app.setErrorHandler((error,_request,reply) => {
    if (error instanceof AskError) return reply.code(error.status).send({error:{code:error.code,message:error.message}});
    const badRequest = typeof error === "object" && error !== null && "statusCode" in error && (error.statusCode === 400 || error.statusCode === 413);
    return reply.code(badRequest ? 400 : 503).send({error:{code:badRequest ? "INVALID_REQUEST":"UNAVAILABLE",message:badRequest ? "Invalid request":"Sensor chat is temporarily unavailable"}});
  });
  app.get("/healthz",async () => ({ok:true}));
  app.get("/readyz",async () => { await options.ping(); return {ok:true}; });
  app.post("/v1/ask",async (request,reply) => {
    const parsed = SensorAskRequest.safeParse(request.body);
    if (!parsed.success) throw new AskError(400,"INVALID_REQUEST","Invalid sensor chat request");
    if (active >= options.concurrency) throw new AskError(429,"BUSY","Sensor chat is busy; retry later");
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),options.deadlineMs);
    const abort = () => controller.abort();
    const responseClosed = () => { if (!reply.raw.writableFinished) abort(); };
    request.raw.on("aborted",abort);
    reply.raw.on("close",responseClosed);
    try { return await answer(parsed.data,options,controller.signal); }
    catch (error) {
      if (error instanceof AskQuotaError) options.write(JSON.stringify({event:"sensor_ask_quota_rejected",request_id:parsed.data.request_id,scope:error.scope})+"\n");
      throw error;
    }
    finally { active--; clearTimeout(timer); request.raw.off("aborted",abort); reply.raw.off("close",responseClosed); }
  });
  app.post("/v1/converse",async (request,reply) => {
    if (!options.chat) throw new AskError(503,"UNAVAILABLE","Device chat is not configured");
    const parsed = DeviceConverseRequest.safeParse(request.body);
    if (!parsed.success) throw new AskError(400,"INVALID_REQUEST","Invalid device chat request");
    // A tool loop holds a slot for several model calls, so it counts against
    // the same concurrency budget as a classifier turn, not a larger one.
    if (active >= options.concurrency) throw new AskError(429,"BUSY","Device chat is busy; retry later");
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),options.chatDeadlineMs ?? options.deadlineMs);
    const abort = () => controller.abort();
    const responseClosed = () => { if (!reply.raw.writableFinished) abort(); };
    request.raw.on("aborted",abort);
    reply.raw.on("close",responseClosed);
    try { return await converse(parsed.data,options.chat,controller.signal); }
    finally { active--; clearTimeout(timer); request.raw.off("aborted",abort); reply.raw.off("close",responseClosed); }
  });
  return app;
}
