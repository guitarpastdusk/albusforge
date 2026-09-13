import { BuildDetail, MessageList, routes } from "@albusforge/schema";
import { Kicker } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";
import { buildStatus } from "@/lib/build-status";
import { cx } from "@/lib/cx";

export default async function BuildPage({ params }: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await params;
  const [build, { messages }] = await Promise.all([
    orNotFound(apiGet(routes.builds.get.path(buildId), BuildDetail)),
    orNotFound(apiGet(routes.builds.messages.path(buildId), MessageList)),
  ]);

  return (
    <main className="mx-auto box-border flex w-full max-w-[860px] flex-1 flex-col px-6 pt-9 pb-7">
      <Kicker>
        {build.name} · {buildStatus[build.display_status].label}
      </Kicker>

      {/*
        Stub. TODO(M2): send via POST /v1/builds/:id/messages, stream replies over
        /v1/builds/:id/events, show the typing dots, the device-ready card and the
        sign-up gate.
      */}
      {messages.length === 0 ? (
        <p className="mt-6 text-[17px] font-light leading-[1.5] text-muted">
          The conversation lands with intake (M2). Until then this page proves the route and the data path.
        </p>
      ) : (
        <ol className="mt-6 flex flex-col gap-[18px]">
          {messages.map((message) => (
            <li
              key={message.id}
              className={cx(
                "max-w-[78%] whitespace-pre-line rounded-[18px] px-[22px] py-4 text-[17px] font-light leading-[1.5]",
                message.role === "user"
                  ? "self-end rounded-br-md bg-ink text-white"
                  : "self-start rounded-bl-md border border-hairline bg-white",
              )}
            >
              {message.text}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
