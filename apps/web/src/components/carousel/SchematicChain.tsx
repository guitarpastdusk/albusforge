import { cx } from "@/lib/cx";

const NODE = "whitespace-nowrap rounded-[10px] border px-3 py-2 font-mono text-[12px]";

function Wire() {
  return <span aria-hidden className="min-w-3.5 flex-1 border-t-[1.5px] border-dashed border-coral-deep" />;
}

export function SchematicChain({ nodes: [input, brain, output] }: { nodes: readonly [string, string, string] }) {
  return (
    <div role="img" aria-label={`${input} → ${brain} → ${output}`} className="flex items-center">
      <span className={cx(NODE, "border-hairline text-ink")}>{input}</span>
      <Wire />
      <span className={cx(NODE, "border-hairline bg-porcelain text-ink")}>{brain}</span>
      <Wire />
      <span className={cx(NODE, "border-ink bg-ink text-white")}>{output}</span>
    </div>
  );
}
