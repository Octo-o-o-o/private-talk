import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  Check,
  CheckSquare,
  Filter,
  Globe,
  Loader2,
  MessageSquare,
  Moon,
  PanelLeftClose,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Sun,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAppStore } from "@/stores/appStore";
import { useI18n } from "@/lib/i18n";
import * as api from "@/lib/tauri";
import type { Conversation, OpenClawAgent, Scenario } from "@/lib/types";
import { getScenarioIcon } from "@/components/scenario/scenarioIcons";
import { cn } from "@/lib/utils";
import { usePreferencesStore } from "@/stores/preferencesStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ScenarioFilter = string | "free-chat" | null;

function parseOpenClawAgentsCache(raw: string): OpenClawAgent[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as OpenClawAgent[] : [];
  } catch {
    return [];
  }
}

export function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    sidebarOpen,
    toggleSidebar,
    scenarios,
    conversations,
    currentConversationId,
    selectConversation,
    createConversation,
    createOpenClawConversation,
    renameConversation,
    deleteConversations,
    loadConversations,
    loadProviders,
    loadScenarios,
    loadVoices,
    loadMessages,
    loadOpenClawInstances,
    openclawInstances,
    isStreaming,
    streamingConversationId,
  } = useAppStore();
  const { language, t, tField, setLanguage } = useI18n();
  const resolvedTheme = usePreferencesStore((state) => state.resolvedTheme);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioFilter>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const openclawAgentsCacheRef = useRef<Record<string, OpenClawAgent[]>>({});
  const [openclawAgents, setOpenclawAgents] = useState<Record<string, OpenClawAgent[]>>({});
  const [loadingAgents, setLoadingAgents] = useState<Record<string, boolean>>({});
  const [openclawErrors, setOpenclawErrors] = useState<Record<string, string | null>>({});
  const [refreshingAgents, setRefreshingAgents] = useState<Record<string, boolean>>({});

  const currentView = getCurrentView(location.pathname);
  const filteredConversations = conversations.filter((conversation) => {
    if (scenarioFilter === null) return true;
    if (scenarioFilter === "free-chat") return conversation.scenario_id === null;
    return conversation.scenario_id === scenarioFilter;
  });
  const visibleConversationIds = filteredConversations.map((conversation) => conversation.id);
  const allVisibleSelected =
    visibleConversationIds.length > 0 &&
    visibleConversationIds.every((id) => selectedIds.has(id));

  useEffect(() => {
    setSelectedIds((prev) => {
      const next = new Set(
        Array.from(prev).filter((id) =>
          conversations.some((conversation) => conversation.id === id)
        )
      );
      return next.size === prev.size ? prev : next;
    });
  }, [conversations]);

  useEffect(() => {
    if (!isSelectionMode) return;

    setSelectedIds((prev) => {
      const visibleIds = new Set(visibleConversationIds);
      const next = new Set(Array.from(prev).filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [isSelectionMode, visibleConversationIds]);

  useEffect(() => {
    const seededAgents: Record<string, OpenClawAgent[]> = {};

    for (const instance of openclawInstances) {
      const cachedAgents = parseOpenClawAgentsCache(instance.agents_cache);
      if (cachedAgents.length === 0) continue;
      seededAgents[instance.id] = cachedAgents;
      if (!openclawAgentsCacheRef.current[instance.id]?.length) {
        openclawAgentsCacheRef.current[instance.id] = cachedAgents;
      }
    }

    if (Object.keys(seededAgents).length === 0) return;

    setOpenclawAgents((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const [instanceId, agents] of Object.entries(seededAgents)) {
        if (!next[instanceId]?.length) {
          next[instanceId] = agents;
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [openclawInstances]);

  const fetchOpenClawAgents = useCallback(
    async (
      instance: {
        id: string;
        name: string;
        gateway_url: string;
        token: string;
      },
      options?: { force?: boolean; background?: boolean }
    ) => {
      const force = options?.force === true;
      const background = options?.background === true;

      if (!force && openclawAgentsCacheRef.current[instance.id]) {
        setOpenclawAgents((prev) => {
          if (prev[instance.id]) return prev;
          return { ...prev, [instance.id]: openclawAgentsCacheRef.current[instance.id] };
        });
        return openclawAgentsCacheRef.current[instance.id];
      }

      if (loadingAgents[instance.id] || refreshingAgents[instance.id]) {
        return openclawAgentsCacheRef.current[instance.id] ?? [];
      }

      if (force) {
        setRefreshingAgents((prev) => ({ ...prev, [instance.id]: true }));
      } else {
        setLoadingAgents((prev) => ({ ...prev, [instance.id]: true }));
      }
      if (!background) {
        setOpenclawErrors((prev) => ({ ...prev, [instance.id]: null }));
      }

      try {
        const agents = await api.listOpenClawAgents(
          instance.gateway_url,
          instance.token,
          instance.id
        );
        openclawAgentsCacheRef.current[instance.id] = agents;
        setOpenclawAgents((prev) => ({ ...prev, [instance.id]: agents }));

        if (!background && agents.length === 0) {
          setOpenclawErrors((prev) => ({
            ...prev,
            [instance.id]: t("未找到可用的 Agent", "No agents found"),
          }));
        }

        return agents;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to list OpenClaw agents:", message);
        if (!background) {
          setOpenclawErrors((prev) => ({ ...prev, [instance.id]: message }));
        }
        return [];
      } finally {
        if (force) {
          setRefreshingAgents((prev) => ({ ...prev, [instance.id]: false }));
        } else {
          setLoadingAgents((prev) => ({ ...prev, [instance.id]: false }));
        }
      }
    },
    [loadingAgents, refreshingAgents, t]
  );

  useEffect(() => {
    const missingInstances = openclawInstances.filter(
      (instance) => openclawAgentsCacheRef.current[instance.id] === undefined
    );

    if (missingInstances.length === 0) return;

    void Promise.allSettled(
      missingInstances.map((instance) =>
        fetchOpenClawAgents(instance, { background: true })
      )
    );
  }, [fetchOpenClawAgents, openclawInstances]);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    setDeleteDialogOpen(false);
  }, []);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    await deleteConversations(Array.from(selectedIds));
    exitSelectionMode();
  }, [deleteConversations, exitSelectionMode, selectedIds]);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);

      if (allVisibleSelected) {
        visibleConversationIds.forEach((id) => next.delete(id));
      } else {
        visibleConversationIds.forEach((id) => next.add(id));
      }

      return next;
    });
  }, [allVisibleSelected, visibleConversationIds]);

  const startEditing = useCallback((conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  }, []);

  const handleSaveTitle = useCallback(async () => {
    if (!editingId) return;

    const nextTitle = editingTitle.trim();
    if (nextTitle) {
      await renameConversation(editingId, nextTitle);
    }

    setEditingId(null);
    setEditingTitle("");
  }, [editingId, editingTitle, renameConversation]);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
    setEditingTitle("");
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        loadConversations(),
        loadProviders(),
        loadScenarios(),
        loadVoices(),
        loadOpenClawInstances(),
      ]);

      if (currentConversationId) {
        await loadMessages(currentConversationId);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [
    currentConversationId,
    loadConversations,
    loadMessages,
    loadOpenClawInstances,
    loadProviders,
    loadScenarios,
    loadVoices,
  ]);

  const toggleTheme = useCallback(async () => {
    await setThemeMode(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setThemeMode]);

  if (!sidebarOpen) {
    return (
      <TooltipProvider>
        <div className="flex h-full w-12 flex-col items-center border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
          <div data-tauri-drag-region className="h-11 w-full shrink-0" />
          <div className="py-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="h-8 w-8 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <PanelLeftClose className="h-4 w-4 rotate-180" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>{t("展开侧边栏", "Expand sidebar")}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="relative flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex shrink-0 items-center justify-end px-2" style={{ height: 44, paddingTop: 6 }}>
          <div data-tauri-drag-region className="absolute inset-x-0 top-0 h-11" />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="relative z-10 h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2 px-4 pb-4">
          <Button
            onClick={() => {
              navigate("/");
              void createConversation();
            }}
            className="w-full bg-primary shadow-lg shadow-primary/20 hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t("新建会话", "New Session")}
          </Button>
          {openclawInstances.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full gap-2 text-xs"
                  size="sm"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {t("OpenClaw Agent", "OpenClaw Agent")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {openclawInstances.map((instance) => (
                  <div key={instance.id}>
                    <DropdownMenuItem
                      className="font-medium text-xs text-muted-foreground"
                      disabled={!!loadingAgents[instance.id]}
                      onSelect={(e) => {
                        e.preventDefault();
                        void fetchOpenClawAgents(instance);
                      }}
                    >
                      {loadingAgents[instance.id] ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : null}
                      {instance.name}
                      {openclawAgents[instance.id] ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="ml-auto h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
                          disabled={!!refreshingAgents[instance.id]}
                          onClick={(e) => {
                            e.stopPropagation();
                            void fetchOpenClawAgents(instance, { force: true });
                          }}
                        >
                          <RotateCcw className={cn("h-3 w-3", refreshingAgents[instance.id] && "animate-spin")} />
                        </Button>
                      ) : null}
                    </DropdownMenuItem>
                    {openclawErrors[instance.id] && !openclawAgents[instance.id] && !loadingAgents[instance.id] ? (
                      <div className="px-3 py-2 text-xs text-destructive">
                        {openclawErrors[instance.id]}
                      </div>
                    ) : null}
                    {openclawAgents[instance.id]?.map((agent) => (
                      <Tooltip key={agent.id}>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            className="pl-6 gap-2"
                            onClick={() => {
                              navigate("/");
                              void createOpenClawConversation(instance.id, agent.id, agent.name);
                            }}
                          >
                            {agent.avatar ? (
                              <img
                                src={agent.avatar}
                                alt={agent.name}
                                className="h-5 w-5 shrink-0 rounded-full object-cover"
                              />
                            ) : agent.emoji ? (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center text-sm">{agent.emoji}</span>
                            ) : null}
                            <span className="truncate">{agent.name}</span>
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        {agent.description ? (
                          <TooltipContent side="right" className="max-w-64">
                            <p>{agent.description}</p>
                          </TooltipContent>
                        ) : null}
                      </Tooltip>
                    ))}
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="px-4 pb-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {t("会话", "Sessions")}
              </p>
              <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground/70">
                {filteredConversations.length}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7",
                      scenarioFilter && "bg-primary/10 text-primary hover:bg-primary/15"
                    )}
                    disabled={scenarios.length === 0 && !hasFreeChatConversations(conversations)}
                  >
                    <Filter className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => setScenarioFilter(null)}>
                    <span className="mr-2">{t("全部", "All")}</span>
                    {scenarioFilter === null && <Check className="ml-auto h-3.5 w-3.5" />}
                  </DropdownMenuItem>
                  {hasFreeChatConversations(conversations) && (
                    <DropdownMenuItem onClick={() => setScenarioFilter("free-chat")}>
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span className="flex-1">{t("自由聊天", "Free Chat")}</span>
                      {scenarioFilter === "free-chat" && (
                        <Check className="ml-auto h-3.5 w-3.5" />
                      )}
                    </DropdownMenuItem>
                  )}
                  {scenarios.length > 0 && <DropdownMenuSeparator />}
                  {scenarios.map((scenario) => (
                    <DropdownMenuItem
                      key={scenario.id}
                      onClick={() => setScenarioFilter(scenario.id)}
                    >
                      <span className="flex-1">{tField(scenario.name, scenario.name_en)}</span>
                      {scenarioFilter === scenario.id && (
                        <Check className="ml-auto h-3.5 w-3.5" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      "h-7 w-7",
                      isSelectionMode && "bg-primary/10 text-primary hover:bg-primary/15"
                    )}
                    onClick={() =>
                      isSelectionMode ? exitSelectionMode() : setIsSelectionMode(true)
                    }
                    disabled={conversations.length === 0}
                  >
                    <CheckSquare className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{t("多选管理", "Multi-select")}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {isSelectionMode && (
            <div className="mb-2 flex items-center justify-between rounded-lg border border-border/50 bg-muted/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t(`已选择 ${selectedIds.size} 项`, `${selectedIds.size} selected`)}
                </span>
                {visibleConversationIds.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-primary hover:text-primary"
                    onClick={handleToggleSelectAll}
                  >
                    {allVisibleSelected
                      ? t("取消全选", "Deselect all")
                      : t("全选", "Select all")}
                  </Button>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={selectedIds.size === 0}
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{t("删除选中", "Delete selected")}</p>
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={exitSelectionMode}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <p>{t("退出多选", "Exit selection")}</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}

          {scenarioFilter !== null && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-primary/10 bg-primary/5 px-2.5 py-1.5">
              <span className="flex-1 text-xs text-primary">
                {getFilterLabel(scenarioFilter, scenarios, t)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground hover:text-foreground"
                onClick={() => setScenarioFilter(null)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1 px-2">
          <div className="space-y-0.5 pb-4">
            {filteredConversations.length > 0 ? (
              filteredConversations.map((conversation) => (
                <SessionItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={
                    currentView === "chat" && conversation.id === currentConversationId
                  }
                  isStreaming={isStreaming && streamingConversationId === conversation.id}
                  isEditing={editingId === conversation.id}
                  isSelected={selectedIds.has(conversation.id)}
                  isSelectionMode={isSelectionMode}
                  editingTitle={editingTitle}
                  scenarios={scenarios}
                  openclawAgents={openclawAgents}
                  onSelect={async () => {
                    await selectConversation(conversation.id);
                    navigate("/");
                  }}
                  onToggleSelection={() => toggleSelection(conversation.id)}
                  onStartEdit={() => startEditing(conversation)}
                  onSaveTitle={() => void handleSaveTitle()}
                  onCancelEdit={handleCancelEdit}
                  onTitleChange={setEditingTitle}
                />
              ))
            ) : (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {t("当前筛选下暂无会话。", "No sessions match this filter.")}
              </div>
            )}
          </div>
        </ScrollArea>

        <GradientDivider />

        <div className="space-y-0.5 p-2">
          <NavButton
            icon={<Volume2 className="h-4 w-4" />}
            label={t("声音", "Voices")}
            tooltip={t("管理 TTS 配置", "Manage TTS profiles")}
            isActive={currentView === "voices"}
            onClick={() => navigate("/voices")}
          />
          <NavButton
            icon={<BarChart3 className="h-4 w-4" />}
            label={t("用量", "Usage")}
            tooltip={t("Token 消耗与费用", "Token usage & costs")}
            isActive={currentView === "usage"}
            onClick={() => navigate("/usage")}
          />
          <NavButton
            icon={<Settings className="h-4 w-4" />}
            label={t("设置", "Settings")}
            tooltip={t("服务商、记忆与 PIN", "Providers, memory & PIN")}
            isActive={currentView === "settings"}
            onClick={() => navigate("/settings")}
          />
        </div>

        <GradientDivider />

        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                >
                  <RotateCcw
                    className={cn("h-4 w-4", isRefreshing && "animate-spin")}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{t("刷新", "Refresh")}</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-lg"
                  onClick={() => void toggleTheme()}
                >
                  {resolvedTheme === "dark" ? (
                    <Moon className="h-4 w-4" />
                  ) : (
                    <Sun className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>{getThemeTooltip(resolvedTheme, t)}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center gap-0.5 rounded-lg border border-border/50 bg-muted/50 p-0.5">
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 rounded-md px-2 text-xs",
                language === "zh-CN" &&
                  "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
              onClick={() => void setLanguage("zh-CN")}
            >
              中文
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 rounded-md px-2 text-xs",
                language === "en-US" &&
                  "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
              onClick={() => void setLanguage("en-US")}
            >
              EN
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("删除选中的会话？", "Delete selected conversations?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `这会从列表中移除当前选中的 ${selectedIds.size} 个会话并删除其消息记录；用量统计会保留，并在用量页显示为“已删除的会话”。`,
                `This removes ${selectedIds.size} selected conversations from the list and deletes their messages. Usage stats are preserved and shown as "Deleted session" on the usage page.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDeleteSelected()}>
              {t("确认删除", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}

function SessionItem({
  conversation,
  isActive,
  isStreaming,
  isEditing,
  isSelected,
  isSelectionMode,
  editingTitle,
  scenarios,
  openclawAgents,
  onSelect,
  onToggleSelection,
  onStartEdit,
  onSaveTitle,
  onCancelEdit,
  onTitleChange,
}: {
  conversation: Conversation;
  isActive: boolean;
  isStreaming: boolean;
  isEditing: boolean;
  isSelected: boolean;
  isSelectionMode: boolean;
  editingTitle: string;
  scenarios: Scenario[];
  openclawAgents: Record<string, OpenClawAgent[]>;
  onSelect: () => void;
  onToggleSelection: () => void;
  onStartEdit: () => void;
  onSaveTitle: () => void;
  onCancelEdit: () => void;
  onTitleChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [isEditing]);

  return (
    <div
      className={cn(
        "group relative flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-foreground transition-all",
        "before:pointer-events-none before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-r-full before:content-['']",
        isSelectionMode
          ? isSelected
            ? "border-primary/20 bg-primary/[0.06] shadow-sm before:bg-primary"
            : "border-transparent hover:border-border/60 hover:bg-sidebar-accent/40 before:bg-transparent"
          : isActive
            ? "border-primary/10 bg-sidebar-accent shadow-sm before:bg-primary"
            : "border-transparent hover:bg-sidebar-accent/50 before:bg-transparent"
      )}
      onClick={isSelectionMode ? onToggleSelection : onSelect}
    >
      {isSelectionMode ? (
        <div className="pt-0.5" onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelection()}
            className="h-4 w-4"
          />
        </div>
      ) : isStreaming ? (
        <div className="shrink-0 pt-0.5 text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : (
        <div
          className={cn(
            "shrink-0 pt-0.5",
            isActive ? "text-primary" : "text-muted-foreground"
          )}
        >
          <SessionIcon
            conversation={conversation}
            scenarios={scenarios}
            openclawAgents={openclawAgents}
          />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <div className="flex items-center gap-1">
            <Input
              ref={inputRef}
              value={editingTitle}
              onChange={(event) => onTitleChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  onSaveTitle();
                } else if (event.key === "Escape") {
                  onCancelEdit();
                }
              }}
              onClick={(event) => event.stopPropagation()}
              className="h-6 px-1.5 py-0 text-sm"
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-primary"
              onClick={(event) => {
                event.stopPropagation();
                onSaveTitle();
              }}
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              onClick={(event) => {
                event.stopPropagation();
                onCancelEdit();
              }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{conversation.title}</p>
          </div>
        )}
      </div>

      {!isSelectionMode && !isEditing && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onStartEdit();
          }}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function SessionIcon({
  conversation,
  scenarios,
  openclawAgents,
}: {
  conversation: Conversation;
  scenarios: Scenario[];
  openclawAgents: Record<string, OpenClawAgent[]>;
}) {
  // OpenClaw conversation → agent avatar
  if (conversation.openclaw_instance_id && conversation.openclaw_agent_id) {
    const agents = openclawAgents[conversation.openclaw_instance_id];
    const agent = agents?.find((a) => a.id === conversation.openclaw_agent_id);
    if (agent?.avatar) {
      return (
        <img
          src={agent.avatar}
          alt={agent.name}
          className="h-4 w-4 rounded-full object-cover"
        />
      );
    }
    return <Globe className="h-4 w-4" />;
  }

  // Scenario conversation → scenario icon
  if (conversation.scenario_id) {
    const scenario = scenarios.find((s) => s.id === conversation.scenario_id);
    if (scenario?.icon) {
      const Icon = getScenarioIcon(scenario.icon);
      if (Icon) return <Icon className="h-4 w-4" />;
    }
  }

  return <MessageSquare className="h-4 w-4" />;
}

function NavButton({
  icon,
  label,
  tooltip,
  isActive,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  tooltip: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
            isActive
              ? "bg-sidebar-accent"
              : "hover:bg-sidebar-accent/50"
          )}
        >
          <span
            className={cn(
              "shrink-0",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            {icon}
          </span>
          <span className="text-sm font-medium">{label}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function GradientDivider() {
  return (
    <div className="mx-4 h-px bg-gradient-to-r from-transparent via-sidebar-border to-transparent" />
  );
}

function getCurrentView(pathname: string) {
  if (pathname.startsWith("/usage")) return "usage";
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/voices")) return "voices";
  if (pathname.startsWith("/scenarios")) return "scenarios";
  return "chat";
}

function getThemeTooltip(
  resolvedTheme: "light" | "dark",
  t: (zh: string, en: string) => string
) {
  return resolvedTheme === "dark"
    ? t("切换到亮色主题", "Switch to light theme")
    : t("切换到暗色主题", "Switch to dark theme");
}

function hasFreeChatConversations(conversations: Conversation[]) {
  return conversations.some((conversation) => conversation.scenario_id === null);
}

function getFilterLabel(
  filter: ScenarioFilter,
  scenarios: Scenario[],
  t: (zh: string, en: string) => string
) {
  if (filter === "free-chat") return t("自由聊天", "Free Chat");
  return (
    scenarios.find((scenario) => scenario.id === filter)?.name ??
    t("场景筛选", "Scenario filter")
  );
}
