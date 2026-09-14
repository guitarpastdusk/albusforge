"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestFirmware, retryFirmware } from "@/actions/firmware";
export function FirmwareControls({
  buildId,
  tenantId,
  planVersion,
  version,
  mode,
}: {
  buildId: string;
  tenantId: string;
  planVersion: number;
  version?: number;
  mode: "compile" | "edit" | "retry";
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [instruction, setInstruction] = useState("Set interval to 120 seconds");
  // Idempotency survives rerenders and uncertain responses for this visible form.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  return (
    <form
      className="mt-4 grid max-w-xl gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result =
            mode === "retry"
              ? await retryFirmware(buildId, version!, tenantId)
              : await requestFirmware(buildId, {
                  tenant_id: tenantId,
                  plan_version: planVersion,
                  request_id: requestId,
                  ...(mode === "edit"
                    ? { instruction, based_on: version }
                    : {}),
                });
          setMessage(result.message);
          router.refresh();
        });
      }}
    >
      {mode === "edit" && (
        <>
          <label className="grid gap-2">
            Firmware edit instruction
            <input
              maxLength={500}
              value={instruction}
              onChange={(e) => {
                setInstruction(e.target.value);
                setRequestId(crypto.randomUUID());
              }}
              disabled={pending}
              className="min-w-0 rounded-xl border border-hairline p-3"
            />
          </label>
          <p className="text-sm text-muted">
            Supported: Set interval to N seconds, from 10 to 86400. A shorter
            interval than the accepted plan needs a new plan.
          </p>
        </>
      )}
      <button
        disabled={pending}
        className="justify-self-start rounded-xl bg-coral-deep px-5 py-3 text-white disabled:opacity-50"
      >
        {pending
          ? "Submitting…"
          : mode === "edit"
            ? "Compile edited version"
            : mode === "retry"
              ? "Retry compile"
              : "Compile firmware"}
      </button>
      <p role="status" className="text-sm">
        {message}
      </p>
    </form>
  );
}
