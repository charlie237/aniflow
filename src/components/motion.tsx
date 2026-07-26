"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import {
  useRef,
  type ElementType,
  type ReactNode
} from "react";
import { cn } from "@/lib/utils";

gsap.registerPlugin(useGSAP);

gsap.defaults({
  ease: "power2.out",
  duration: 0.36
});

type AnimateInProps = {
  children: ReactNode;
  className?: string;
  /** Index-based stagger delay (each step ≈ 60ms). */
  delay?: number;
  y?: number;
  duration?: number;
  as?: ElementType;
};

/**
 * Fade + slight rise on mount.
 * useGSAP + matchMedia(prefers-reduced-motion); target via ref/scope.
 */
export function AnimateIn({
  children,
  className,
  delay = 0,
  y = 10,
  duration = 0.38,
  as: Tag = "div"
}: AnimateInProps) {
  const ref = useRef<HTMLElement | null>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(el, { autoAlpha: 1, y: 0, clearProps: "transform" });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(el, {
          autoAlpha: 0,
          y,
          duration,
          delay: delay * 0.06,
          clearProps: "transform"
        });
      });

      return () => mm.revert();
    },
    { scope: ref, dependencies: [delay, y, duration] }
  );

  return (
    <Tag ref={ref as never} className={cn(className)}>
      {children}
    </Tag>
  );
}

type StaggerChildrenProps = {
  children: ReactNode;
  className?: string;
  y?: number;
  duration?: number;
  stagger?: number;
};

/**
 * Stagger-animates direct children once on mount.
 * Uses container.children (refs), not unscoped selectors.
 */
export function StaggerChildren({
  children,
  className,
  y = 12,
  duration = 0.36,
  stagger = 0.05
}: StaggerChildrenProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      const root = ref.current;
      if (!root) return;

      const items = gsap.utils.toArray<HTMLElement>(root.children);
      if (!items.length) return;

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: reduce)", () => {
        gsap.set(items, { autoAlpha: 1, y: 0, clearProps: "transform" });
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(items, {
          autoAlpha: 0,
          y,
          duration,
          stagger,
          clearProps: "transform"
        });
      });

      return () => mm.revert();
    },
    // Mount-only — don't replay when RSC re-renders after filter/query changes.
    { scope: ref }
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

type CountUpProps = {
  value: number;
  className?: string;
  duration?: number;
};

/** Animate integer count-up when `value` is first shown or changes. */
export function CountUp({ value, className, duration = 0.55 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;

      const mm = gsap.matchMedia();

      mm.add("(prefers-reduced-motion: reduce)", () => {
        el.textContent = String(value);
      });

      mm.add("(prefers-reduced-motion: no-preference)", () => {
        if (value === 0) {
          el.textContent = "0";
          return;
        }

        const state = { n: 0 };
        el.textContent = "0";
        gsap.to(state, {
          n: value,
          duration,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = String(Math.round(state.n));
          }
        });
      });

      return () => mm.revert();
    },
    { scope: ref, dependencies: [value, duration], revertOnUpdate: true }
  );

  return (
    <span ref={ref} className={className}>
      0
    </span>
  );
}
