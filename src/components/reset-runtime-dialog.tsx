"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { resetRuntimeDataAction } from "@/app/actions";
import { useI18n } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RUNTIME_RESET_CONFIRM_PHRASE } from "@/lib/runtime-reset";

export function ResetRuntimeDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const canSubmit = confirmText.trim() === RUNTIME_RESET_CONFIRM_PHRASE;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="danger">
          <Trash2 />
          {t("reset.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("reset.title")}</DialogTitle>
          <DialogDescription>{t("reset.description")}</DialogDescription>
        </DialogHeader>
        <form
          action={resetRuntimeDataAction}
          className="grid gap-4"
          onSubmit={(event) => {
            if (!canSubmit) {
              event.preventDefault();
              return;
            }
            setOpen(false);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="confirmRuntimeReset">
              {t("reset.typeToConfirm", { phrase: RUNTIME_RESET_CONFIRM_PHRASE })}
            </Label>
            <Input
              id="confirmRuntimeReset"
              name="confirmRuntimeReset"
              type="text"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              placeholder={RUNTIME_RESET_CONFIRM_PHRASE}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="danger" disabled={!canSubmit}>
              <Trash2 />
              {t("reset.confirm")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
