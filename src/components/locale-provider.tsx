"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import { setLocaleAction } from "@/app/locale-actions";
import {
  createT,
  type Locale,
  type Messages,
  type TranslateFn
} from "@/lib/i18n";
import { formatDateTime as formatDateTimeBase } from "@/lib/time";

type LocaleContextValue = {
  locale: Locale;
  messages: Messages;
  t: TranslateFn;
  setLocale: (locale: Locale) => Promise<void>;
  formatDateTime: (value?: string | null) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  messages,
  children
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useMemo(() => createT(messages), [messages]);

  const setLocale = useCallback(
    async (next: Locale) => {
      if (next === locale) return;
      await setLocaleAction(next);
      router.refresh();
    },
    [locale, router]
  );

  const formatDateTime = useCallback(
    (value?: string | null) =>
      formatDateTimeBase(value, {
        locale,
        never: t("common.never")
      }),
    [locale, t]
  );

  const value = useMemo(
    () => ({ locale, messages, t, setLocale, formatDateTime }),
    [formatDateTime, locale, messages, setLocale, t]
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LocaleProvider");
  }
  return ctx;
}
