import { Me } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { ApiRequestError, GatewayError, request, summarizeIssues, type TransportResponse } from "./core";

const answer = (response: TransportResponse) => async () => response;

describe("request against something that isn't the API", () => {
  it("throws GatewayError not_json for a 200 HTML page (the hello placeholder)", async () => {
    const call = request(
      answer({ status: 200, contentType: "text/html; charset=utf-8", isJson: false, json: undefined }),
      "GET",
      "/v1/me",
      Me,
    );
    await expect(call).rejects.toBeInstanceOf(GatewayError);
    await expect(call).rejects.toMatchObject({
      details: { route: "GET /v1/me", status: 200, contentType: "text/html; charset=utf-8", reason: "not_json" },
    });
  });

  it("throws GatewayError schema_mismatch with a short issue summary", async () => {
    const call = request(
      answer({ status: 200, contentType: "application/json", isJson: true, json: { user: {} } }),
      "GET",
      "/v1/me?x=1",
      Me,
    );
    await expect(call).rejects.toMatchObject({
      name: "GatewayError",
      details: { route: "GET /v1/me", reason: "schema_mismatch", issues: expect.stringMatching(/^user\.id: .+\(\+\d+ more\)$/) },
    });
  });

  it("throws GatewayError unexpected_status for a failure without the error shape", async () => {
    await expect(
      request(answer({ status: 502, contentType: "text/html", isJson: false, json: undefined }), "GET", "/v1/me", Me),
    ).rejects.toMatchObject({ details: { reason: "unexpected_status", status: 502 } });
  });

  it("still throws ApiRequestError for the API error shape", async () => {
    await expect(
      request(
        answer({ status: 404, contentType: "application/json", isJson: true, json: { error: { code: "not_found", message: "nope" } } }),
        "GET",
        "/v1/devices/x/dashboard",
        Me,
      ),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe("summarizeIssues", () => {
  it("shows up to three issues and counts the rest", () => {
    const issues = [
      { path: ["tenant"], message: "Required" },
      { path: [], message: "Bad root" },
      { path: ["user", "email"], message: "Invalid email" },
      { path: ["x"], message: "four" },
    ];
    expect(summarizeIssues(issues)).toBe("tenant: Required; (root): Bad root; user.email: Invalid email (+1 more)");
  });
});
