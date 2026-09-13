import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font is a build-time transform; there is nothing to load under vitest.
vi.mock("@/app/fonts", () => ({ fontVariables: "" }));

const { default: RouteError } = await import("@/app/error");
const { default: GlobalError } = await import("@/app/global-error");
const { Button } = await import("@/components/ui");
const { ServiceUnavailable } = await import("./ServiceUnavailable");

/** Expand function components (all pure here) until the Button, and return its onClick. */
function findButtonOnClick(node: ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButtonOnClick(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (element.type === Button) return element.props.onClick;
  if (typeof element.type === "function") {
    return findButtonOnClick((element.type as (props: unknown) => ReactNode)(element.props));
  }
  return findButtonOnClick(element.props.children);
}

const failure = (digest?: string) => Object.assign(new Error("An error occurred in the Server Components render."), { digest });

describe("ServiceUnavailable", () => {
  it("renders the kicker, title, body and Try again", () => {
    const html = renderToStaticMarkup(<ServiceUnavailable onRetry={() => {}} />);
    expect(html).toContain("Service unavailable");
    expect(html).toContain("We can’t reach the service right now.");
    expect(html).toContain("This page couldn’t load what it needs.");
    expect(html).toContain("Try again");
  });

  it("shows the reference only when there is a digest", () => {
    expect(renderToStaticMarkup(<ServiceUnavailable digest="2408655454" onRetry={() => {}} />)).toContain(
      "Reference: 2408655454",
    );
    expect(renderToStaticMarkup(<ServiceUnavailable onRetry={() => {}} />)).not.toContain("Reference");
  });

  it("never shows the error message itself", () => {
    const html = renderToStaticMarkup(<RouteError error={failure("1")} retry={() => {}} />);
    expect(html).not.toContain("Server Components render");
  });
});

describe("app/error.tsx", () => {
  it("passes the digest through and Try again calls retry", () => {
    const retry = vi.fn();
    expect(renderToStaticMarkup(<RouteError error={failure("2408655454")} retry={retry} />)).toContain(
      "Reference: 2408655454",
    );

    const onClick = findButtonOnClick(<RouteError error={failure("2408655454")} retry={retry} />);
    expect(onClick).toBeTypeOf("function");
    onClick!();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("app/global-error.tsx", () => {
  it("renders its own document, the same copy, and Try again calls retry", () => {
    const retry = vi.fn();
    const html = renderToStaticMarkup(<GlobalError error={failure("77")} retry={retry} />);
    expect(html).toMatch(/^<html lang="en"/);
    expect(html).toContain("<title>Service unavailable · albusforge.ai</title>");
    expect(html).toContain("We can’t reach the service right now.");
    expect(html).toContain("Reference: 77");

    findButtonOnClick(<GlobalError error={failure("77")} retry={retry} />)!();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
