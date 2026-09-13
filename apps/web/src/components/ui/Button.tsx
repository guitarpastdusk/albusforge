import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";

export type ButtonVariant = "dark" | "coral";

const VARIANTS: Record<ButtonVariant, string> = {
  dark: "bg-ink text-white hover:bg-coral hover:text-white",
  coral: "bg-coral text-white hover:bg-coral-deep hover:text-white",
};

interface Look {
  variant?: ButtonVariant;
  pill?: boolean;
}

function classes({ variant = "dark", pill = false }: Look, className?: string) {
  return cx(
    "inline-flex items-center justify-center whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    pill && "rounded-full",
    className,
  );
}

export function Button({ variant, pill, className, type = "button", ...props }: ComponentProps<"button"> & Look) {
  return <button type={type} className={classes({ variant, pill }, className)} {...props} />;
}

export function ButtonLink({ variant, pill, className, ...props }: ComponentProps<typeof Link> & Look) {
  return <Link className={classes({ variant, pill }, className)} {...props} />;
}
