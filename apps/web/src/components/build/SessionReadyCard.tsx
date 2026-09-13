"use client";

import { Suspense, use, type ComponentProps } from "react";
import { DesignReadyCard } from "./DesignReadyCard";

type Props = Omit<ComponentProps<typeof DesignReadyCard>, "signedIn"> & {
  signedIn: boolean | Promise<boolean>;
};

function ResolvedCard({ signedIn, ...props }: Props) {
  const resolved = typeof signedIn === "boolean" ? signedIn : use(signedIn);
  return <DesignReadyCard {...props} signedIn={resolved} />;
}

/** Session latency can suspend this optional CTA, never the hero or conversation. */
export function SessionReadyCard({ signedIn, ...props }: Props) {
  return (
    <Suspense fallback={<DesignReadyCard {...props} signedIn={false} />}>
      <ResolvedCard {...props} signedIn={signedIn} />
    </Suspense>
  );
}
