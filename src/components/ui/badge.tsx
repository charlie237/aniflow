import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-[6px] border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-[var(--line)] bg-white text-[var(--foreground)]",
        signal: "border-[#008f6840] bg-[#008f6814] text-[#006b4f]",
        amber: "border-[#d9770640] bg-[#d9770618] text-[#9a4f00]",
        violet: "border-[#6d5bd040] bg-[#6d5bd014] text-[#5042a0]",
        danger: "border-[#d92d2040] bg-[#d92d2012] text-[#b42318]",
        muted: "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)]"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
