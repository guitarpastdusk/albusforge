import Link from "next/link";
import { FirmwarePage } from "@albusforge/schema";
import { PageContainer } from "@/components/ui";
import { FirmwareControls } from "@/components/firmware/FirmwareControls";
import { apiGet, orNotFound } from "@/lib/api/server";
import { requireSession } from "@/lib/session";
export const metadata = { title: "Firmware" };
export default async function Firmware({
  params,
}: {
  params: Promise<{ buildId: string }>;
}) {
  const { buildId } = await params;
  await requireSession(`/projects/${encodeURIComponent(buildId)}/firmware`);
  const data = await orNotFound(
    apiGet(`/v1/builds/${encodeURIComponent(buildId)}/code`, FirmwarePage),
  );
  const busy = data.versions.some(
    (v) => v.status === "pending" || v.status === "running",
  );
  return (
    <PageContainer>
      <Link href={`/projects/${buildId}`} className="text-muted">
        ← Project
      </Link>
      <h1 className="mt-5 text-3xl font-semibold">Firmware</h1>
      <p className="mt-3 max-w-3xl text-muted">
        Versioned firmware from your accepted hardware plan. A successful
        compile checks software; it does not establish physical wiring, sensor
        or power compatibility.
      </p>
      <form className="mt-4">
        <button className="rounded-xl border border-hairline px-5 py-3">
          Refresh firmware status
        </button>
      </form>
      {!data.accepted_plan_version ? (
        <p className="mt-6">
          Accept the current hardware plan before compiling firmware.
        </p>
      ) : !data.compiler_available ? (
        <p className="mt-6">
          This plan has no available compiler. The first supported candidate is
          ESP32-S3 with BH1750; reviewed hardware evidence and configured
          compilation infrastructure are required.
        </p>
      ) : data.can_edit && !busy ? (
        <FirmwareControls
          key={`compile-${data.accepted_plan_version}`}
          buildId={buildId}
          tenantId={data.tenant_id}
          planVersion={data.accepted_plan_version}
          mode="compile"
        />
      ) : null}
      {!data.can_edit && (
        <p className="mt-4 text-muted">
          Operators and admins can request firmware changes. You can inspect and
          download compiled versions.
        </p>
      )}
      <ol className="mt-8 grid gap-6">
        {data.versions.map((version) => (
          <li
            key={version.version}
            className="rounded-2xl border border-hairline p-5 min-w-0"
          >
            <h2 className="text-xl font-semibold">
              Version {version.version} · {version.status}
            </h2>
            <p className="mt-2 text-sm text-muted">
              Plan {version.plan_version} ·{" "}
              {version.current ? "Current accepted plan" : "Earlier plan"} ·{" "}
              {version.interval_s === null
                ? "Interval unavailable"
                : `${version.interval_s} second interval`}{" "}
              · Attempt {version.attempts} of 3
            </p>
            {version.error && (
              <p role="status" className="mt-3">
                {version.error}
              </p>
            )}
            {version.status === "passed" && (
              <div className="mt-4">
                <a
                  href={`/v1/builds/${buildId}/code/${version.version}/files/firmware.zip`}
                  className="inline-block rounded-xl bg-coral-deep px-5 py-3 text-white"
                >
                  Download firmware ZIP
                </a>
                {version.current && (
                  <Link
                    href={`/setup?build=${buildId}&plan=${version.plan_version}&code=${version.version}`}
                    className="ml-4 inline-block py-3 text-coral-deep underline"
                  >
                    Set up this device
                  </Link>
                )}
                <p className="mt-3 text-sm text-muted">
                  The ZIP contains credential-free firmware, its manifest and a
                  local installer. Obtain a fresh device configuration through
                  setup; Wi-Fi details stay on your computer. Reflashing an
                  existing device requires a newly reissued configuration.
                </p>
              </div>
            )}
            {version.source && (
              <details className="mt-4">
                <summary className="cursor-pointer">
                  Inspect SDK app{version.previous_source ? " and change" : ""}
                </summary>
                {version.previous_source && (
                  <>
                    <p className="mt-3 text-sm">Before</p>
                    <pre className="overflow-x-auto rounded-lg bg-sand p-3 text-xs">
                      {version.previous_source}
                    </pre>
                  </>
                )}
                <p className="mt-3 text-sm">
                  {version.previous_source ? "After" : "Source"}
                </p>
                <pre className="overflow-x-auto rounded-lg bg-sand p-3 text-xs">
                  {version.source}
                </pre>
              </details>
            )}
            {version.diagnostics && (
              <details className="mt-4">
                <summary className="cursor-pointer">
                  Compiler diagnostics
                </summary>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-sand p-3 text-xs">
                  {version.diagnostics}
                </pre>
              </details>
            )}
            {data.can_edit &&
              data.compiler_available &&
              version.current &&
              !busy &&
              version.status === "passed" && (
                <FirmwareControls
                  buildId={buildId}
                  tenantId={data.tenant_id}
                  planVersion={version.plan_version}
                  version={version.version}
                  mode="edit"
                />
              )}
            {data.can_edit &&
              data.compiler_available &&
              version.current &&
              !busy &&
              version.status === "failed" &&
              version.attempts < 3 && (
                <FirmwareControls
                  buildId={buildId}
                  tenantId={data.tenant_id}
                  planVersion={version.plan_version}
                  version={version.version}
                  mode="retry"
                />
              )}
          </li>
        ))}
      </ol>
      {!data.versions.length && (
        <p className="mt-8">No firmware versions have been requested.</p>
      )}
    </PageContainer>
  );
}
