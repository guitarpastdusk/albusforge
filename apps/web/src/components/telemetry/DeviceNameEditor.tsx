"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameTelemetryDevice } from "@/actions/telemetry-metadata";

export function DeviceNameEditor({
  id,
  name,
  version,
}: {
  id: string;
  name: string | null;
  version: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(name ?? ""),
    [currentVersion, setVersion] = useState(version);
  const [message, setMessage] = useState(""),
    [needsRefresh, setNeedsRefresh] = useState(false),
    [pending, startTransition] = useTransition();
  return (
    <form
      className="mt-5 max-w-lg"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await renameTelemetryDevice(id, value, currentVersion);
          if (result.ok) {
            setValue(result.data.display_name ?? "");
            setVersion(result.data.version);
            setMessage("Device name saved.");
            router.refresh();
          } else {
            setMessage(result.message);
            setNeedsRefresh(result.refresh);
          }
        });
      }}
    >
      <label className="grid gap-2 font-medium" htmlFor="device-display-name">
        Device display name
        <input
          id="device-display-name"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
          disabled={pending || needsRefresh}
          className="w-full min-w-0 rounded-xl border border-hairline px-4 py-3"
          aria-describedby="device-name-help"
        />
      </label>
      <p id="device-name-help" className="mt-2 text-sm text-muted">
        A workspace label only. Leave blank to show the device ID. Provisioned
        channels and firmware are unchanged.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          disabled={pending || needsRefresh}
          className="rounded-xl bg-coral-deep px-5 py-3 text-white disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save name"}
        </button>
        {needsRefresh && (
          <button
            type="button"
            onClick={() =>
              startTransition(() => {
                router.refresh();
                setNeedsRefresh(false);
                setMessage("");
              })
            }
            className="rounded-xl border border-hairline px-5 py-3"
          >
            Refresh device
          </button>
        )}
      </div>
      <p role="status" className="mt-3 text-sm">
        {message}
      </p>
    </form>
  );
}
