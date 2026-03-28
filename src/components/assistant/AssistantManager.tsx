import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/tauri";
import { useState } from "react";
import { Plus, Edit2, Trash2, Copy, Eye, ArrowLeft, Check, MessageSquare, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import type { Assistant } from "../../lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MobileMenuButton } from "@/components/layout/MobileMenuButton";
import { useDesktopWindowDrag } from "@/hooks/useDesktopWindowDrag";

export function AssistantManager() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { assistants, currentAssistantId, loadAssistants, selectAssistant } = useAppStore();
  const headerDragProps = useDesktopWindowDrag();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const handleEdit = (assistant: Assistant) => {
    navigate(`/assistants/edit/${assistant.id}`);
  };

  const handleView = (assistant: Assistant) => {
    navigate(`/assistants/view/${assistant.id}`);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteAssistant(id);
      await loadAssistants();
    } catch (e) {
      console.error("Delete assistant failed:", e);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await api.duplicateAssistant(id);
      await loadAssistants();
    } catch (e) {
      console.error("Duplicate assistant failed:", e);
    }
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full flex-col bg-background">
      <div
        {...headerDragProps}
        className="flex h-14 select-none items-center justify-between border-b border-border px-4 md:px-6"
      >
        <div className="flex items-center gap-3">
          <MobileMenuButton />
          <Button variant="ghost" size="icon-sm" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{t("助手", "Assistants")}</h1>
        </div>
        <Button onClick={() => navigate("/assistants/new")}>
          <Plus className="mr-2 h-4 w-4" />
          {t("新建助手", "New Assistant")}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-2xl p-4 md:p-6 pb-safe-6">
          <p className="mb-6 text-sm text-muted-foreground">
            {t(
              "每个助手都可以绑定系统提示词、语音路由和播放行为，新会话会自动继承这些设置。",
              "Each assistant bundles its instructions, voice routing, and playback behavior for new chats."
            )}
          </p>

          <div className="space-y-3">
            <AssistantCard
              assistant={null}
              isSelected={currentAssistantId === null}
              onSelect={() => void selectAssistant(null)}
            />
            {assistants.map((assistant) => (
              <AssistantCard
                key={assistant.id}
                assistant={assistant}
                isSelected={assistant.id === currentAssistantId}
                onSelect={() => void selectAssistant(assistant.id)}
                onView={assistant.is_preset ? () => handleView(assistant) : undefined}
                onEdit={!assistant.is_preset ? () => handleEdit(assistant) : undefined}
                onDelete={!assistant.is_preset ? () => { setPendingDeleteId(assistant.id); setDeleteConfirmOpen(true); } : undefined}
                onDuplicate={() => void handleDuplicate(assistant.id)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("删除助手？", "Delete assistant?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "此操作将永久删除这个助手配置，无法撤销。",
                "This will permanently delete this assistant. This action cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingDeleteId) void handleDelete(pendingDeleteId); }}>
              {t("确认删除", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface AssistantCardProps {
  assistant: Assistant | null;
  isSelected: boolean;
  onSelect: () => void;
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

function AssistantCard({
  assistant,
  isSelected,
  onSelect,
  onView,
  onEdit,
  onDelete,
  onDuplicate,
}: AssistantCardProps) {
  const isFreeChat = assistant === null;
  const { t, tField } = useI18n();

  return (
    <Card
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/30",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
            {isFreeChat ? (
              <MessageSquare className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Sparkles className="h-5 w-5 text-muted-foreground" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-medium">{isFreeChat ? t("自由对话", "Free Chat") : tField(assistant.name, assistant.name_en)}</h3>
              {!isFreeChat && assistant.is_preset ? (
                <Badge variant="secondary" className="text-xs">
                  {t("预设", "Preset")}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFreeChat
                ? t(
                    "启动不带预设提示词和语音路由的新会话。",
                    "Start a chat without preset instructions or voice routing."
                  )
                : tField(assistant.description, assistant.description_en)}
            </p>
            {!isFreeChat && assistant.system_prompt ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground/80">
                {assistant.system_prompt}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {isSelected ? (
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                <Check className="h-4 w-4 text-primary-foreground" />
              </div>
            ) : null}
            {!isFreeChat && onView ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  onView();
                }}
              >
                <Eye className="h-4 w-4" />
              </Button>
            ) : null}
            {!isFreeChat && onDuplicate ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  onDuplicate();
                }}
              >
                <Copy className="h-4 w-4" />
              </Button>
            ) : null}
            {!isFreeChat && onEdit ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit();
                }}
              >
                <Edit2 className="h-4 w-4" />
              </Button>
            ) : null}
            {!isFreeChat && onDelete ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
