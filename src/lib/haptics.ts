import { isTauri } from "@tauri-apps/api/core";
import { detectPlatform } from "./appearance";
import * as api from "./tauri";

/**
 * Best-effort tactile feedback. On iOS Tauri shells we delegate to
 * UIKit's feedback generators via the native bridge; everywhere else
 * (desktop, plain browser, Android — until that bridge lands) we
 * silently drop the call.
 *
 * Callers should treat these as fire-and-forget — failure is never
 * a reason to interrupt the user-facing interaction.
 */

function shouldEmit(): boolean {
  if (!isTauri()) {
    return false;
  }
  return detectPlatform() === "ios";
}

export type ImpactStyle = "light" | "medium" | "heavy" | "soft" | "rigid";
export type NotificationKind = "success" | "warning" | "error";

export function hapticImpact(style: ImpactStyle = "light"): void {
  if (!shouldEmit()) {
    return;
  }
  void api.hapticImpact(style).catch(() => {});
}

export function hapticNotification(kind: NotificationKind): void {
  if (!shouldEmit()) {
    return;
  }
  void api.hapticNotification(kind).catch(() => {});
}

export function hapticSelection(): void {
  if (!shouldEmit()) {
    return;
  }
  void api.hapticSelection().catch(() => {});
}
