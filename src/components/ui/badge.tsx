import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border-[var(--line)] bg-[var(--panel)] text-[var(--foreground)]",
        signal:
          "border-[var(--signal-soft-border)] bg-[var(--signal-soft)] text-[var(--signal-text)]",
        amber:
          "border-[var(--accent-soft-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]",
        violet:
          "border-[var(--violet-soft-border)] bg-[var(--violet-soft)] text-[var(--violet-text)]",
        danger:
          "border-[var(--danger-soft-border)] bg-[var(--danger-soft)] text-[var(--danger-text)]",
        muted:
          "border-[var(--line)] bg-[var(--panel-strong)] text-[var(--muted)]"
      },
      size: {
        default: "px-2 py-0.5 text-xs font-medium",
        status: "px-2.5 py-1 text-sm font-semibold"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}
