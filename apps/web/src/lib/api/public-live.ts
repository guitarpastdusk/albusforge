import {
  DeviceSetupStatus,
  TelemetryDeviceDetail,
  TelemetryFleetPage,
  TelemetryHistory,
  TelemetryLatest,
  routes,
} from "@albusforge/schema";
import { apiGet } from "./server";

/*
 * Reads for the public showcase.
 *
 * These call /v1/public/live/*, which the gateway registers only when it has a
 * showcase tenant configured, and which resolves that tenant from its own
 * configuration rather than from anything in the request. The response shapes
 * are the authenticated ones unchanged — the gateway serves the same handler
 * bodies — so every component renders here exactly as it does when signed in.
 *
 * Nothing in this module takes a tenant, a session or an actor. There is no
 * parameter here that could select whose devices are shown.
 */

export const publicLive = {
  fleet: (query: URLSearchParams) => apiGet(`${routes.publicLive.devices.path()}?${query}`, TelemetryFleetPage),
  device: (id: string) => apiGet(`${routes.publicLive.device.path(id)}?presentation=1`, TelemetryDeviceDetail),
  latest: (id: string) => apiGet(routes.publicLive.latest.path(id), TelemetryLatest),
  series: (id: string, query: URLSearchParams) => apiGet(`${routes.publicLive.series.path(id)}?${query}`, TelemetryHistory),
  setup: (id: string) => apiGet(routes.publicLive.setup.path(id), DeviceSetupStatus),
};
