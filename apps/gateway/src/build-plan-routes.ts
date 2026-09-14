import { BuildPlanRequest } from "@albusforge/schema";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { parse } from "./http";
import { assertSameOrigin } from "./mutation-origin";
import { createBuildPlanStore } from "./build-plan-store";
import type { ReviewedPlanCatalogue } from "./build-plan-catalogue";
const Build = z.strictObject({id:z.uuid()});
const Plan = Build.extend({version:z.coerce.number().int().positive()});
export function registerBuildPlans(app: FastifyInstance, pool: Pool, catalogue?: ReviewedPlanCatalogue) {
  const store = createBuildPlanStore(pool,catalogue);
  app.register(async scope => {
    scope.addHook("onRequest",async(_request,reply)=>{reply.header("cache-control","private, no-store");});
    scope.get("/v1/builds/:id/plans",async request => {
      const {id}=parse(Build,request.params,"build id");
      return store.list(request.headers.cookie,request.hostname,id);
    });
    scope.post("/v1/builds/:id/plans",async request => {
      assertSameOrigin(request);
      const {id}=parse(Build,request.params,"build id"), body=parse(BuildPlanRequest,request.body,"plan request");
      return store.solve(request.headers.cookie,request.hostname,id,body);
    });
    scope.post("/v1/builds/:id/plans/:version/accept",async request => {
      assertSameOrigin(request);
      const {id,version}=parse(Plan,request.params,"plan"), body=parse(BuildPlanRequest,request.body,"plan request");
      return store.accept(request.headers.cookie,request.hostname,id,version,body);
    });
  });
}
