import { z } from "zod";
import { Id } from "./common";

export const RequestCodeRequest = z.object({
  email: z.email(),
});
export type RequestCodeRequest = z.infer<typeof RequestCodeRequest>;

/**
 * Anonymous builds are claimed through the `__Host-albus_anon` cookie that
 * accompanies this request, not through a body field (PORTAL.md §5).
 */
export const VerifyCodeRequest = z.object({
  email: z.email(),
  code: z.string().regex(/^\d{6}$/),
});
export type VerifyCodeRequest = z.infer<typeof VerifyCodeRequest>;

export const TenantRole = z.enum(["admin", "operator", "viewer"]);
export type TenantRole = z.infer<typeof TenantRole>;

export const TenantMembership = z.object({
  id: Id,
  name: z.string(),
  /** Null until the tenant claims a subdomain. */
  slug: z.string().nullable(),
  role: TenantRole,
});
export type TenantMembership = z.infer<typeof TenantMembership>;

export const Me = z.object({
  user: z.object({
    id: Id,
    email: z.email(),
    display_name: z.string().nullable(),
  }),
  /** The active tenant; every tenant-scoped read uses this one. */
  tenant: TenantMembership,
  /** Every tenant the user belongs to, active one included — for a switcher. */
  tenants: z.array(TenantMembership).min(1),
});
export type Me = z.infer<typeof Me>;

/** POST /v1/auth/verify returns the session in the same shape as GET /v1/me, plus Set-Cookie. */
export const VerifyCodeResponse = Me;
export type VerifyCodeResponse = Me;

/** PUT /v1/me/active-tenant → 204. */
export const SetActiveTenantRequest = z.strictObject({
  tenant_id: z.uuid(),
});
export type SetActiveTenantRequest = z.infer<typeof SetActiveTenantRequest>;
