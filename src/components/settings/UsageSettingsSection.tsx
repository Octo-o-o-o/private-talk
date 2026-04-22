import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import type { ConversationUsage, DailyUsage, ModelUsage } from "../../lib/types";
import { buttonStyles } from "./formControls";
import { SettingsSection } from "./SettingsPage";

type UsageView = "conversation" | "date";

function totalTokens(usages: ModelUsage[]): number {
  return usages.reduce((sum, usage) => sum + usage.total_tokens, 0);
}

function totalRequests(usages: ModelUsage[]): number {
  return usages.reduce((sum, usage) => sum + usage.request_count, 0);
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

function parseTimestamp(value: string): Date | null {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatTimestamp(value: string, locale: string): string {
  const date = parseTimestamp(value);
  if (!date) {
    return value;
  }
  return date.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(value: string, locale: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

function leadModelLabel(usages: ModelUsage[]): string | null {
  const label = usages[0]?.model ?? null;
  if (!label) {
    return null;
  }
  return label.length > 26 ? `${label.slice(0, 26)}...` : label;
}

export function UsageSettingsSection() {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<UsageView>("conversation");
  const [conversationUsages, setConversationUsages] = useState<ConversationUsage[]>([]);
  const [dailyUsages, setDailyUsages] = useState<DailyUsage[]>([]);

  async function loadUsage(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [byConversation, byDate] = await Promise.all([
        api.getUsageByConversation(),
        api.getUsageByDate(),
      ]);
      setConversationUsages(byConversation);
      setDailyUsages(byDate);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("读取用量失败。", "Failed to load usage."),
      );
    } finally {
      setHasLoaded(true);
      setLoading(false);
    }
  }

  useEffect(() => {
    if (expanded && !hasLoaded && !loading) {
      void loadUsage();
    }
  }, [expanded, hasLoaded, loading]);

  const totalRequestCount = useMemo(
    () => {
      if (conversationUsages.length > 0) {
        return conversationUsages.reduce((sum, usage) => sum + usage.total_requests, 0);
      }
      return dailyUsages.reduce((sum, usage) => sum + totalRequests(usage.model_usages), 0);
    },
    [conversationUsages, dailyUsages],
  );
  const totalTokenCount = useMemo(
    () => {
      if (conversationUsages.length > 0) {
        return conversationUsages.reduce(
          (sum, usage) => sum + totalTokens(usage.model_usages),
          0,
        );
      }
      return dailyUsages.reduce((sum, usage) => sum + totalTokens(usage.model_usages), 0);
    },
    [conversationUsages, dailyUsages],
  );
  const currentCount = view === "conversation" ? conversationUsages.length : dailyUsages.length;
  const hasUsage = conversationUsages.length > 0 || dailyUsages.length > 0;

  return (
    <SettingsSection
      title={t("用量", "Usage")}
      footer={t(
        "这里只显示本地记录下来的 token 用量，不会额外把数据发送到第三方统计服务。",
        "This section shows locally recorded token usage only. No extra analytics service is involved.",
      )}
    >
      <button
        type="button"
        className="pt-settings-row pt-settings-row--interactive"
        onClick={() => {
          setExpanded((value) => !value);
        }}
      >
        <div className="pt-settings-row__copy">
          <div className="pt-settings-row__title-line">
            <p className="pt-settings-row__title">{t("Token 统计", "Token Usage")}</p>
            <ChevronDown
              size={16}
              className={`pt-row-chevron${expanded ? " is-open" : ""}`}
            />
          </div>
          <p className="pt-settings-row__detail">
            {hasUsage
              ? t(
                  `${formatTokens(totalTokenCount)} tokens · ${totalRequestCount} 次请求`,
                  `${formatTokens(totalTokenCount)} tokens · ${totalRequestCount} requests`,
                )
              : hasLoaded
                ? t("还没有记录到任何 token 用量。", "No token usage recorded yet.")
                : t("按会话和日期查看本地 token 消耗", "View local token usage by chat or day")}
          </p>
        </div>
      </button>

      {expanded ? (
        <div className="pt-settings-expand">
          <div className="pt-usage-overview">
            <article className="pt-usage-stat">
              <div className="pt-usage-stat__eyebrow">
                <MessageSquareText size={13} />
                <span>{t("总请求", "Requests")}</span>
              </div>
              <p className="pt-usage-stat__value">{totalRequestCount}</p>
              <p className="pt-usage-stat__detail">
                {t(
                  `${conversationUsages.length} 个会话`,
                  `${conversationUsages.length} chats`,
                )}
              </p>
            </article>
            <article className="pt-usage-stat">
              <div className="pt-usage-stat__eyebrow">
                <ArrowUpRight size={13} />
                <span>{t("总 Tokens", "Total Tokens")}</span>
              </div>
              <p className="pt-usage-stat__value">{formatTokens(totalTokenCount)}</p>
              <p className="pt-usage-stat__detail">
                {t("本地累计记录", "Locally recorded total")}
              </p>
            </article>
            <article className="pt-usage-stat">
              <div className="pt-usage-stat__eyebrow">
                <CalendarDays size={13} />
                <span>{view === "conversation" ? t("会话视图", "Chats") : t("日期视图", "Days")}</span>
              </div>
              <p className="pt-usage-stat__value">{currentCount}</p>
              <p className="pt-usage-stat__detail">
                {view === "conversation"
                  ? t("按会话查看模型消耗", "Model usage by chat")
                  : t("按日期查看聚合结果", "Daily aggregated usage")}
              </p>
            </article>
          </div>

          <div className="pt-settings-form__actions pt-settings-form__actions--start">
            <button
              type="button"
              className={`${buttonStyles.compactChip}${view === "conversation" ? " is-active" : ""}`}
              onClick={() => setView("conversation")}
            >
              {t("按会话", "By Chat")}
            </button>
            <button
              type="button"
              className={`${buttonStyles.compactChip}${view === "date" ? " is-active" : ""}`}
              onClick={() => setView("date")}
            >
              {t("按日期", "By Day")}
            </button>
            <button
              type="button"
              className={buttonStyles.compactChip}
              onClick={() => void loadUsage()}
            >
              {t("刷新", "Refresh")}
            </button>
          </div>

          {error ? <p className="pt-form-error">{error}</p> : null}
          {loading ? (
            <p className="pt-settings-help">{t("正在加载用量...", "Loading usage...")}</p>
          ) : null}

          {!loading && !error ? (
            view === "conversation" ? (
              <div className="pt-usage-list">
                {conversationUsages.length === 0 ? (
                  <p className="pt-settings-help">
                    {t("还没有记录到任何 token 用量。", "No token usage recorded yet.")}
                  </p>
                ) : (
                  conversationUsages.map((usage) => (
                    <ConversationUsageCard
                      key={usage.conversation_id}
                      locale={locale}
                      usage={usage}
                      t={t}
                    />
                  ))
                )}
              </div>
            ) : (
              <div className="pt-usage-list">
                {dailyUsages.length === 0 ? (
                  <p className="pt-settings-help">
                    {t("还没有按日期汇总的用量。", "No daily usage summary yet.")}
                  </p>
                ) : (
                  dailyUsages.map((usage) => (
                    <DailyUsageCard
                      key={usage.date}
                      locale={locale}
                      usage={usage}
                      t={t}
                    />
                  ))
                )}
              </div>
            )
          ) : null}
        </div>
      ) : null}
    </SettingsSection>
  );
}

function ConversationUsageCard({
  usage,
  locale,
  t,
}: {
  usage: ConversationUsage;
  locale: string;
  t: (zh: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const modelLabel = leadModelLabel(usage.model_usages);
  const title = usage.is_deleted
    ? t("已删除的会话", "Deleted chat")
    : usage.conversation_title || t("未命名会话", "Untitled chat");
  const preview = usage.is_deleted
    ? t(
        "会话内容已删除，但本地 usage 记录仍然保留。",
        "Messages were deleted, but local usage history is still preserved.",
      )
    : usage.first_message_preview || t("暂无预览", "No preview");

  return (
    <article className={`pt-usage-row${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="pt-usage-row__button"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <ChevronRight size={16} className={`pt-usage-row__chevron${open ? " is-open" : ""}`} />
        <div className="pt-usage-row__main">
          <div className="pt-usage-row__title-line">
            <p className="pt-usage-row__title">{title}</p>
            {usage.is_deleted ? (
              <span className="pt-usage-pill pt-usage-pill--danger">
                {t("已删除", "Deleted")}
              </span>
            ) : (
              <span className="pt-usage-pill">
                {t(`${usage.message_count} 条消息`, `${usage.message_count} msgs`)}
              </span>
            )}
            {modelLabel ? (
              <span className="pt-usage-pill pt-usage-pill--muted">
                {modelLabel}
                {usage.model_usages.length > 1 ? ` +${usage.model_usages.length - 1}` : ""}
              </span>
            ) : null}
          </div>
          <p className="pt-usage-row__detail">{preview}</p>
          <div className="pt-usage-row__meta">
            <span>{t("最近使用", "Latest")} {formatTimestamp(usage.latest_at, locale)}</span>
            <span>{t(`${usage.total_requests} 次请求`, `${usage.total_requests} requests`)}</span>
          </div>
        </div>
        <div className="pt-usage-row__summary">
          <strong>{formatTokens(totalTokens(usage.model_usages))}</strong>
          <span>{t(`${usage.model_usages.length} 个模型`, `${usage.model_usages.length} models`)}</span>
        </div>
      </button>

      {open ? (
        <div className="pt-usage-row__body">
          <div className="pt-usage-row__facts">
            <span>{t("创建于", "Created")} {formatTimestamp(usage.created_at, locale)}</span>
            <span>{t("更新于", "Updated")} {formatTimestamp(usage.updated_at, locale)}</span>
          </div>
          <div className="pt-usage-model-list">
            {usage.model_usages.map((modelUsage) => (
              <ModelUsageRow key={modelUsage.model} usage={modelUsage} t={t} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function DailyUsageCard({
  usage,
  locale,
  t,
}: {
  usage: DailyUsage;
  locale: string;
  t: (zh: string, en: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const modelLabel = leadModelLabel(usage.model_usages);

  return (
    <article className={`pt-usage-row${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="pt-usage-row__button"
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        <ChevronRight size={16} className={`pt-usage-row__chevron${open ? " is-open" : ""}`} />
        <div className="pt-usage-row__main">
          <div className="pt-usage-row__title-line">
            <p className="pt-usage-row__title">{formatDay(usage.date, locale)}</p>
            <span className="pt-usage-pill">
              {t(
                `${usage.conversation_count} 个会话`,
                `${usage.conversation_count} chats`,
              )}
            </span>
            {modelLabel ? (
              <span className="pt-usage-pill pt-usage-pill--muted">
                {modelLabel}
                {usage.model_usages.length > 1 ? ` +${usage.model_usages.length - 1}` : ""}
              </span>
            ) : null}
          </div>
          <p className="pt-usage-row__detail">
            {t(
              `${totalRequests(usage.model_usages)} 次请求 · ${usage.model_usages.length} 个模型`,
              `${totalRequests(usage.model_usages)} requests · ${usage.model_usages.length} models`,
            )}
          </p>
        </div>
        <div className="pt-usage-row__summary">
          <strong>{formatTokens(totalTokens(usage.model_usages))}</strong>
          <span>{t("当天累计", "Daily total")}</span>
        </div>
      </button>

      {open ? (
        <div className="pt-usage-row__body">
          <div className="pt-usage-model-list">
            {usage.model_usages.map((modelUsage) => (
              <ModelUsageRow key={modelUsage.model} usage={modelUsage} t={t} />
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ModelUsageRow({
  usage,
  t,
}: {
  usage: ModelUsage;
  t: (zh: string, en: string) => string;
}) {
  return (
    <div className="pt-usage-model-row">
      <div className="pt-usage-model-row__main">
        <span className="pt-usage-model-row__name">{usage.model}</span>
        <span className="pt-usage-inline-metrics">
          <span className="pt-usage-inline-metric">
            <ArrowDownRight size={12} />
            <span>{formatTokens(usage.prompt_tokens)} in</span>
          </span>
          <span className="pt-usage-inline-metric">
            <ArrowUpRight size={12} />
            <span>{formatTokens(usage.completion_tokens)} out</span>
          </span>
        </span>
      </div>
      <span className="pt-usage-model-row__stat">
        {formatTokens(usage.total_tokens)} ·{" "}
        {t(`${usage.request_count} 次`, `${usage.request_count} calls`)}
      </span>
    </div>
  );
}
