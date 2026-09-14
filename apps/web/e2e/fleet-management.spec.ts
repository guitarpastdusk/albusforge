import { randomUUID } from "node:crypto";
import { test, expect } from "./stack";

test("fleet search, pagination and role-bound name edits at narrow and desktop widths", async ({
  page,
  context,
  stack,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === stack.webUrl
      ? route.continue()
      : route.abort(),
  );
  await page.goto(`${stack.webUrl}/signin?next=%2Flive`);
  await page.getByLabel("Email", { exact: true }).fill("fleet@example.test");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeVisible();
  await page
    .getByLabel("6-digit code")
    .fill(await stack.codeFor("fleet@example.test"));
  await page.getByRole("button", { name: "Verify & sign in" }).click();
  await expect(page).toHaveURL(`${stack.webUrl}/live`);
  const account = (
    await stack.pool.query(
      "SELECT s.user_id,s.active_tenant_id FROM users.sessions s JOIN users.users u ON u.id=s.user_id WHERE u.email=$1",
      ["fleet@example.test"],
    )
  ).rows[0];
  const ids = Array.from({ length: 52 }, () => randomUUID());
  for (const [i, id] of ids.entries())
    await stack.pool.query(
      "INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,display_name) VALUES($1,$2,$3,$4,'{}',$5)",
      [
        id,
        account.active_tenant_id,
        randomUUID(),
        { temperature: { unit: "C", min: -40, max: 85 } },
        i === 0 ? "Literal %_ sensor" : `Sensor ${i}`,
      ],
    );
  for (const width of [320, 1440]) {
    await stack.pool.query(
      "UPDATE users.tenant_members SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
      [account.active_tenant_id, account.user_id],
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${stack.webUrl}/live`);
    await expect(
      page.getByText("Showing 50 devices on this page.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Next page →" }).click();
    await expect(
      page.getByText("Showing 2 devices on this page.", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("searchbox", { name: "Search name or device ID" })
      .fill("%_");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).not.toHaveURL(/after=/);
    await expect(
      page.getByText("Showing 1 devices on this page.", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Literal %_ sensor", exact: true }),
    ).toBeVisible();
    const editId = ids[1]!;
    await page.goto(`${stack.webUrl}/live/${editId}`);
    await page.getByLabel("Device display name").fill(`Renamed at ${width}`);
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: `Renamed at ${width}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("No device health packet has been recorded.", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    await page.screenshot({
      path: testInfo.outputPath(`fleet-edit-${width}.png`),
      fullPage: true,
    });
    await stack.pool.query(
      "UPDATE telemetry.devices SET display_name='Concurrent edit',metadata_version=metadata_version+1 WHERE id=$1",
      [editId],
    );
    await page.getByLabel("Device display name").fill("Must not overwrite");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(
      page.getByText("Someone changed this name.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Refresh device" }).click();
    await expect(page.getByLabel("Device display name")).toHaveValue(
      "Concurrent edit",
    );
    await stack.pool.query(
      "UPDATE users.tenant_members SET role='viewer' WHERE tenant_id=$1 AND user_id=$2",
      [account.active_tenant_id, account.user_id],
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Save name", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Device labels can be edited by workspace operators and admins.",
      ),
    ).toBeVisible();
    const cookie = (await context.cookies()).find(
      (c) => c.name === "__Host-albus_session",
    )!;
    const denied = await fetch(
      `${stack.gatewayUrl}/v1/telemetry/devices/${editId}/metadata`,
      {
        method: "PATCH",
        headers: {
          cookie: `${cookie.name}=${cookie.value}`,
          origin: stack.gatewayUrl,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          display_name: "forbidden",
          expected_version: 0,
        }),
      },
    );
    expect(denied.status).toBe(403);
  }
  expect(errors).toEqual([]);
});
