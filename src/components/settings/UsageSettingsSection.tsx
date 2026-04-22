import { ChevronDown } from "lucide-react";
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

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return String(value);
}

export function UsageSettingsSection() {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
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
      setLoading(false);
    }
  }

  useEffect(() => {
    if (expanded && conversationUsages.length === 0 && !loading && !error) {
      void loadUsage();
    }
  }, [conversationUsages.length, error, expanded, loading]);

  const totalRequests = useMemo(
    () =>
      conversationUsages.reduce((sum, usage) => sum + usage.total_requests, 0),
    [conversationUsages],
  );
  const totalTokenCount = useMemo(
    () =>
      conversationUsages.reduce(
        (sum, usage) => sum + totalTokens(usage.model_usages),
        0,
      ),
    [conversationUsages],
  );

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
            {conversationUsages.length > 0
              ? t(
                  `${formatTokens(totalTokenCount)} tokens · ${totalRequests} 次请求`,
                  `${formatTokens(totalTokenCount)} tokens · ${totalRequests} requests`,
                )
              : t("按会话和日期查看本地 token 消耗", "View local token usage by chat or day")}
          </p>
        </div>
      </button>

      {expanded ? (
        <div className="pt-settings-expand">
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
                    <article key={usage.conversation_id} className="pt-usage-card">
                      <div className="pt-usage-card__header">
                        <div>
                          <p className="pt-usage-card__title">{usage.conversation_title}</p>
                          <p className="pt-usage-card__detail">{usage.first_message_preview}</p>
                        </div>
                        <div className="pt-usage-card__summary">
                          <span>{formatTokens(totalTokens(usage.model_usages))}</span>
                          <span>
                            {t(
                              `${usage.total_requests} 次请求`,
                              `${usage.total_requests} requests`,
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="pt-usage-model-list">
                        {usage.model_usages.map((modelUsage) => (
                          <div key={modelUsage.model} className="pt-usage-model-row">
                            <span className="pt-usage-model-row__name">{modelUsage.model}</span>
                            <span className="pt-usage-model-row__meta">
                              {formatTokens(modelUsage.prompt_tokens)} in ·{" "}
                              {formatTokens(modelUsage.completion_tokens)} out
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="pt-usage-card__timestamp">
                        {new Date(usage.latest_at).toLocaleString(
                          locale === "zh-CN" ? "zh-CN" : "en-US",
                        )}
                      </p>
                    </article>
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
                    <article key={usage.date} className="pt-usage-card">
                      <div className="pt-usage-card__header">
                        <div>
                          <p className="pt-usage-card__title">
                            {new Date(`${usage.date}T00:00:00`).toLocaleDateString(
                              locale === "zh-CN" ? "zh-CN" : "en-US",
                              {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              },
                            )}
                          </p>
                          <p className="pt-usage-card__detail">
                            {t(
                              `${usage.conversation_count} 个会话`,
                              `${usage.conversation_count} chats`,
                            )}
                          </p>
                        </div>
                        <div className="pt-usage-card__summary">
                          <span>{formatTokens(totalTokens(usage.model_usages))}</span>
                          <span>{usage.model_usages.length} models</span>
                        </div>
                      </div>
                      <div className="pt-usage-model-list">
                        {usage.model_usages.map((modelUsage) => (
                          <div key={modelUsage.model} className="pt-usage-model-row">
                            <span className="pt-usage-model-row__name">{modelUsage.model}</span>
                            <span className="pt-usage-model-row__meta">
                              {formatTokens(modelUsage.total_tokens)} tokens ·{" "}
                              {modelUsage.request_count} calls
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
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
