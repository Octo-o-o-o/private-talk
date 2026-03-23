import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  ChevronRight,
  DollarSign,
  MessageSquare,
  RefreshCw,
  Zap,
} from "lucide-react";

import { useI18n } from "@/lib/i18n";
import * as api from "@/lib/tauri";
import type { ConversationUsage, DailyUsage, ModelUsage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";

type ViewMode = "session" | "date";
type PricingMap = Record<string, { prompt: number; completion: number }>;

let cachedPricing: PricingMap | null = null;

async function fetchPricing(): Promise<PricingMap> {
  if (cachedPricing) return cachedPricing;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    const data = await response.json();
    const nextPricing: PricingMap = {};

    for (const model of data.data ?? []) {
      if (!model.id || !model.pricing) continue;

      const prompt = parseFloat(model.pricing.prompt) || 0;
      const completion = parseFloat(model.pricing.completion) || 0;
      nextPricing[model.id] = { prompt, completion };

      const shortName = model.id.split("/").pop();
      if (shortName && !nextPricing[shortName]) {
        nextPricing[shortName] = { prompt, completion };
      }
    }

    cachedPricing = nextPricing;
    return nextPricing;
  } catch {
    return {};
  }
}

function lookupPrice(
  pricing: PricingMap,
  model: string
): { prompt: number; completion: number } | null {
  if (pricing[model]) return pricing[model];

  const shortName = model.split("/").pop() ?? model;
  if (pricing[shortName]) return pricing[shortName];

  for (const [key, value] of Object.entries(pricing)) {
    if (key.includes(model) || model.includes(key.split("/").pop() ?? "")) {
      return value;
    }
  }

  return null;
}

function calcCost(pricing: PricingMap, usage: ModelUsage) {
  const price = lookupPrice(pricing, usage.model);
  if (!price) return 0;

  return usage.prompt_tokens * price.prompt + usage.completion_tokens * price.completion;
}

function calcTotalCost(pricing: PricingMap, usages: ModelUsage[]) {
  return usages.reduce((sum, usage) => sum + calcCost(pricing, usage), 0);
}

function sumTokens(usages: ModelUsage[]) {
  return usages.reduce((sum, usage) => sum + usage.total_tokens, 0);
}

function sumInputTokens(usages: ModelUsage[]) {
  return usages.reduce((sum, usage) => sum + usage.prompt_tokens, 0);
}

function sumOutputTokens(usages: ModelUsage[]) {
  return usages.reduce((sum, usage) => sum + usage.completion_tokens, 0);
}

function formatCost(cost: number) {
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function formatDateTime(value: string, locale: string) {
  return new Date(value).toLocaleDateString(locale, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateFull(value: string, locale: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function getCollapsedModelLabel(usages: ModelUsage[]) {
  const model = usages[0]?.model ?? null;
  if (!model) return null;
  return model.length > 22 ? `${model.slice(0, 22)}...` : model;
}

export function UsagePage() {
  const { locale, t } = useI18n();
  const [viewMode, setViewMode] = useState<ViewMode>("session");
  const [conversationUsages, setConversationUsages] = useState<ConversationUsage[]>([]);
  const [dailyUsages, setDailyUsages] = useState<DailyUsage[]>([]);
  const [pricing, setPricing] = useState<PricingMap>({});
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [conversationData, dailyData, pricingData] = await Promise.all([
        api.getUsageByConversation(),
        api.getUsageByDate(),
        fetchPricing(),
      ]);
      setConversationUsages(conversationData);
      setDailyUsages(dailyData);
      setPricing(pricingData);
    } catch (error) {
      console.error("Failed to load usage data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const conversationTokenTotal = conversationUsages.reduce(
    (sum, usage) => sum + sumTokens(usage.model_usages),
    0
  );
  const totalInputTokens = conversationUsages.reduce(
    (sum, usage) => sum + sumInputTokens(usage.model_usages),
    0
  );
  const totalOutputTokens = conversationUsages.reduce(
    (sum, usage) => sum + sumOutputTokens(usage.model_usages),
    0
  );
  const conversationCostTotal = conversationUsages.reduce(
    (sum, usage) => sum + calcTotalCost(pricing, usage.model_usages),
    0
  );

  const dailyTokenTotal = dailyUsages.reduce(
    (sum, usage) => sum + sumTokens(usage.model_usages),
    0
  );
  const dailyCostTotal = dailyUsages.reduce(
    (sum, usage) => sum + calcTotalCost(pricing, usage.model_usages),
    0
  );

  const totalTokens = conversationUsages.length > 0 ? conversationTokenTotal : dailyTokenTotal;
  const totalCost = conversationUsages.length > 0 ? conversationCostTotal : dailyCostTotal;
  const hasPricing = Object.keys(pricing).length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/10 bg-gradient-to-br from-primary/20 to-primary/5">
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">
                {t("用量统计", "Usage Statistics")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("跟踪 Token 消耗与费用", "Track token consumption and costs")}
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {t("刷新", "Refresh")}
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-6">
          <div className="flex items-stretch gap-3">
            <StatCard
              icon={<Zap className="h-3.5 w-3.5" />}
              label={t("总 Token", "Total Tokens")}
              value={formatTokens(totalTokens)}
              sublabel={`${formatTokens(totalInputTokens)} ${t("入", "in")} / ${formatTokens(totalOutputTokens)} ${t("出", "out")}`}
              className="flex-1"
            />
            <StatCard
              icon={<DollarSign className="h-3.5 w-3.5" />}
              label={t("总费用", "Total Cost")}
              value={formatCost(totalCost)}
              highlight
              className="flex-1"
            />
            <StatCard
              icon={
                viewMode === "session" ? (
                  <MessageSquare className="h-3.5 w-3.5" />
                ) : (
                  <Calendar className="h-3.5 w-3.5" />
                )
              }
              label={viewMode === "session" ? t("会话数", "Sessions") : t("天数", "Days")}
              value={
                viewMode === "session"
                  ? conversationUsages.length.toString()
                  : dailyUsages.length.toString()
              }
              className="flex-1"
            />
          </div>

          {!hasPricing && !loading && (
            <p className="text-xs text-muted-foreground">
              {t(
                "当前未获取到模型定价，费用会显示为 $0.00。",
                "Model pricing is unavailable right now, so costs are shown as $0.00."
              )}
            </p>
          )}

          <div className="flex w-fit rounded-lg border border-border/50 bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("session")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                viewMode === "session"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {t("会话视图", "Session View")}
            </button>
            <button
              type="button"
              onClick={() => setViewMode("date")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                viewMode === "date"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Calendar className="h-3.5 w-3.5" />
              {t("日期视图", "Date View")}
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-20">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : viewMode === "session" ? (
            <SessionList
              locale={locale}
              pricing={pricing}
              sessions={conversationUsages}
              t={t}
            />
          ) : (
            <DateList dailyUsages={dailyUsages} locale={locale} pricing={pricing} t={t} />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
  highlight,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "gap-0 border-border/50 px-4 py-3 shadow-none",
        highlight && "border-primary/20 bg-primary/5",
        className
      )}
    >
      <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
        {icon}
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className={cn("text-xl font-semibold tracking-tight", highlight && "text-primary")}>
        {value}
      </p>
      {sublabel && <p className="mt-0.5 text-[10px] text-muted-foreground">{sublabel}</p>}
    </Card>
  );
}

function SessionList({
  sessions,
  pricing,
  locale,
  t,
}: {
  sessions: ConversationUsage[];
  pricing: PricingMap;
  locale: string;
  t: (zh: string, en: string) => string;
}) {
  if (sessions.length === 0) {
    return (
      <Card className="border-border/50 py-0 shadow-none">
        <Empty className="border-0 py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BarChart3 />
            </EmptyMedia>
            <EmptyTitle>{t("暂无用量记录", "No usage records")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "开始对话之后，这里会显示每个会话的 Token 和费用明细。",
                "Token and cost details will appear here after you start chatting."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <SessionRow
          key={session.conversation_id}
          locale={locale}
          pricing={pricing}
          session={session}
          t={t}
        />
      ))}
    </div>
  );
}

function SessionRow({
  session,
  pricing,
  locale,
  t,
}: {
  session: ConversationUsage;
  pricing: PricingMap;
  locale: string;
  t: (zh: string, en: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalCost = calcTotalCost(pricing, session.model_usages);
  const totalTokens = sumTokens(session.model_usages);
  const collapsedModelLabel = getCollapsedModelLabel(session.model_usages);
  const modelCount = session.model_usages.length;
  const sessionTitle = session.is_deleted
    ? t("已删除的会话", "Deleted session")
    : session.conversation_title || t("未命名会话", "Untitled session");
  const sessionPreview = session.is_deleted
    ? t(
        "会话内容已删除，但用量记录仍然保留。",
        "Messages were deleted, but usage history is still preserved."
      )
    : session.first_message_preview || t("暂无预览", "No preview");

  return (
    <Card className="gap-0 overflow-hidden border-border/50 py-0 shadow-none">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium">{sessionTitle}</h3>
            {session.is_deleted && (
              <Badge variant="secondary" className="shrink-0 bg-muted/60 text-[10px]">
                {t("已删除", "Deleted")}
              </Badge>
            )}
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {session.message_count} {t("条消息", "msgs")}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{sessionPreview}</p>
        </div>

        {!expanded && collapsedModelLabel && (
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <Badge variant="secondary" className="bg-muted/50 font-mono text-[10px]">
              {collapsedModelLabel}
            </Badge>
            {modelCount > 1 && (
              <span className="text-[10px] text-muted-foreground">+{modelCount - 1}</span>
            )}
          </div>
        )}

        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-primary">{formatCost(totalCost)}</p>
          <p className="text-[10px] text-muted-foreground">{formatTokens(totalTokens)}</p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 bg-muted/10">
          <div className="flex flex-wrap items-center gap-4 border-b border-border/30 px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              {t("创建", "Created")} {formatDateTime(session.created_at, locale)}
            </span>
            <span>
              {t("更新", "Updated")} {formatDateTime(session.updated_at, locale)}
            </span>
          </div>

          {session.model_usages.map((usage, index) => (
            <ModelRow key={`${usage.model}-${index}`} pricing={pricing} usage={usage} t={t} />
          ))}
        </div>
      )}
    </Card>
  );
}

function DateList({
  dailyUsages,
  pricing,
  locale,
  t,
}: {
  dailyUsages: DailyUsage[];
  pricing: PricingMap;
  locale: string;
  t: (zh: string, en: string) => string;
}) {
  if (dailyUsages.length === 0) {
    return (
      <Card className="border-border/50 py-0 shadow-none">
        <Empty className="border-0 py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Calendar />
            </EmptyMedia>
            <EmptyTitle>{t("暂无用量记录", "No usage records")}</EmptyTitle>
            <EmptyDescription>
              {t(
                "开始对话之后，这里会显示按日期聚合的用量信息。",
                "Usage grouped by date will appear here after you start chatting."
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {dailyUsages.map((day) => (
        <DateRow key={day.date} day={day} locale={locale} pricing={pricing} t={t} />
      ))}
    </div>
  );
}

function DateRow({
  day,
  pricing,
  locale,
  t,
}: {
  day: DailyUsage;
  pricing: PricingMap;
  locale: string;
  t: (zh: string, en: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const totalCost = calcTotalCost(pricing, day.model_usages);
  const totalTokens = sumTokens(day.model_usages);
  const collapsedModelLabel = getCollapsedModelLabel(day.model_usages);
  const modelCount = day.model_usages.length;

  return (
    <Card className="gap-0 overflow-hidden border-border/50 py-0 shadow-none">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-muted/30"
      >
        <ChevronRight
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90"
          )}
        />

        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{formatDateFull(day.date, locale)}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {day.conversation_count} {t("个会话", "sessions")}
          </p>
        </div>

        {!expanded && collapsedModelLabel && (
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            <Badge variant="secondary" className="bg-muted/50 font-mono text-[10px]">
              {collapsedModelLabel}
            </Badge>
            {modelCount > 1 && (
              <span className="text-[10px] text-muted-foreground">+{modelCount - 1}</span>
            )}
          </div>
        )}

        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-primary">{formatCost(totalCost)}</p>
          <p className="text-[10px] text-muted-foreground">{formatTokens(totalTokens)}</p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 bg-muted/10">
          {day.model_usages.map((usage, index) => (
            <ModelRow key={`${usage.model}-${index}`} pricing={pricing} usage={usage} t={t} />
          ))}
        </div>
      )}
    </Card>
  );
}

function ModelRow({
  usage,
  pricing,
  t,
}: {
  usage: ModelUsage;
  pricing: PricingMap;
  t: (zh: string, en: string) => string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border/20 px-4 py-2.5 last:border-b-0">
      <Badge
        variant="secondary"
        className="max-w-[180px] shrink-0 truncate bg-background/50 font-mono text-[10px]"
      >
        {usage.model}
      </Badge>

      <div className="flex flex-1 items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <ArrowDownRight className="h-3 w-3 text-primary" />
          <span className="font-mono">{formatTokens(usage.prompt_tokens)}</span>
        </span>
        <span className="flex items-center gap-1">
          <ArrowUpRight className="h-3 w-3 text-success" />
          <span className="font-mono">{formatTokens(usage.completion_tokens)}</span>
        </span>
        <span className="text-muted-foreground/70">
          {usage.request_count} {t("次调用", "calls")}
        </span>
      </div>

      <span className="shrink-0 text-xs font-medium">{formatCost(calcCost(pricing, usage))}</span>
    </div>
  );
}
