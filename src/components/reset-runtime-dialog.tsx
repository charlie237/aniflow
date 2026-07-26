"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { resetRuntimeDataAction } from "@/app/actions";
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
          清空运行数据
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>清空运行数据</DialogTitle>
          <DialogDescription>
            将删除 RSS 抓取结果、解析元数据、下载队列和文件扫描记录。后台设置、订阅和筛选规则会保留。此操作不可撤销。
          </DialogDescription>
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
              请输入「{RUNTIME_RESET_CONFIRM_PHRASE}」以确认
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
              取消
            </Button>
            <Button type="submit" variant="danger" disabled={!canSubmit}>
              <Trash2 />
              确认清空
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
