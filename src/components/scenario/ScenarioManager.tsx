import { useAppStore } from "../../stores/appStore";
import * as api from "../../lib/tauri";
import { Plus, Edit2, Trash2, Copy, Eye, ArrowLeft, Check, MessageSquare, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/lib/i18n";
import type { Scenario } from "../../lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export function ScenarioManager() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { scenarios, currentScenarioId, loadScenarios, selectScenario } = useAppStore();

  const handleEdit = (scenario: Scenario) => {
    navigate(`/scenarios/edit/${scenario.id}`);
  };

  const handleView = (scenario: Scenario) => {
    navigate(`/scenarios/view/${scenario.id}`);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteScenario(id);
      await loadScenarios();
    } catch (e) {
      console.error("Delete scenario failed:", e);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await api.duplicateScenario(id);
      await loadScenarios();
    } catch (e) {
      console.error("Duplicate scenario failed:", e);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-lg font-semibold">{t("场景", "Scenarios")}</h1>
        </div>
        <Button onClick={() => navigate("/scenarios/new")}>
          <Plus className="mr-2 h-4 w-4" />
          {t("新建场景", "New Scenario")}
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-2xl p-6">
          <p className="mb-6 text-sm text-muted-foreground">
            {t(
              "场景会把系统提示词、可选的语音路由和播放行为一起绑定到新会话上。",
              "Scenarios bundle a system prompt, optional voice routing, and playback behavior for new sessions."
            )}
          </p>

          <div className="space-y-3">
            <ScenarioCard
              scenario={null}
              isSelected={currentScenarioId === null}
              onSelect={() => void selectScenario(null)}
            />
            {scenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                isSelected={scenario.id === currentScenarioId}
                onSelect={() => void selectScenario(scenario.id)}
                onView={scenario.is_preset ? () => handleView(scenario) : undefined}
                onEdit={!scenario.is_preset ? () => handleEdit(scenario) : undefined}
                onDelete={!scenario.is_preset ? () => void handleDelete(scenario.id) : undefined}
                onDuplicate={() => void handleDuplicate(scenario.id)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

interface ScenarioCardProps {
  scenario: Scenario | null;
  isSelected: boolean;
  onSelect: () => void;
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}

function ScenarioCard({
  scenario,
  isSelected,
  onSelect,
  onView,
  onEdit,
  onDelete,
  onDuplicate,
}: ScenarioCardProps) {
  const isFreeChat = scenario === null;
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
              <h3 className="font-medium">{isFreeChat ? t("自由对话", "Free Chat") : tField(scenario.name, scenario.name_en)}</h3>
              {!isFreeChat && scenario.is_preset ? (
                <Badge variant="secondary" className="text-xs">
                  {t("预设", "Preset")}
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {isFreeChat
                ? t(
                    "启动不带预设提示词和语音路由的新会话。",
                    "Start sessions without a preset system prompt or voice routing."
                  )
                : tField(scenario.description, scenario.description_en)}
            </p>
            {!isFreeChat && scenario.system_prompt ? (
              <p className="mt-2 line-clamp-2 text-xs text-muted-foreground/80">
                {scenario.system_prompt}
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
