import {
  ArrowLeft,
  BookOpen,
  Bot,
  ChevronRight,
  Languages,
  Mic,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import { useAppStore } from "../../stores/appStore";
import type { LayoutMode } from "../layout/useLayoutMode";
import { AssistantSettingsSection } from "./AssistantSettings";
import { AppearanceSettingsSection } from "./AppearanceSettings";
import { BackupSettingsSection } from "./BackupSettingsSection";
import { ConversationAssistantsSection } from "./ConversationAssistantsSection";
import {
  ImageGenerationSettingsSection,
  ImageRoutingSettingsSection,
} from "./ImageGenerationSettings";
import { LanguageSettingsSection } from "./LanguageSettings";
import { MemorySettingsSection } from "./MemorySettings";
import { ModelRoutingSettingsSection } from "./ModelRoutingSettings";
import { PinSettingsSection } from "./PinSettings";
import { ProviderForm } from "./ProviderForm";
import { SpeechRoutingSettingsSection } from "./SpeechSettings";
import { UsageSettingsSection } from "./UsageSettingsSection";
import {
  VoiceOutputSettingsSection,
  VoiceRoutingSettingsSection,
} from "./VoiceOutputSettings";

interface SettingsPageProps {
  layout: LayoutMode;
  onBack: () => void;
}

export type SettingsGroupId =
  | "general"
  | "assistants"
  | "models"
  | "media"
  | "data"
  | "about";

type SettingsGroup = {
  id: SettingsGroupId;
  title: string;
  description: string;
  icon: LucideIcon;
  content: ReactNode;
};

export function SettingsPage({ layout, onBack }: SettingsPageProps) {
  const isPhone = layout === "phone";
  const { t } = useI18n();
  const settingsTargetGroupId = useAppStore((state) => state.settingsTargetGroupId);
  const clearSettingsTargetGroup = useAppStore(
    (state) => state.clearSettingsTargetGroup,
  );
  const desktopDragProps = !isPhone ? { "data-tauri-drag-region": true } : {};
  const [selectedGroupId, setSelectedGroupId] = useState<SettingsGroupId | null>(
    isPhone ? settingsTargetGroupId : settingsTargetGroupId ?? "general",
  );

  const groups: SettingsGroup[] = [
    {
      id: "general",
      title: t("通用", "General"),
      description: t(
        "语言、外观和界面缩放。",
        "Language, appearance, and interface zoom.",
      ),
      icon: Languages,
      content: (
        <>
          <LanguageSettingsSection />
          <AppearanceSettingsSection />
        </>
      ),
    },
    {
      id: "assistants",
      title: t("助手", "Assistants"),
      description: t(
        "全局助手偏好与自定义助手库。",
        "Global assistant defaults and custom assistant library.",
      ),
      icon: Sparkles,
      content: (
        <>
          <AssistantSettingsSection />
          <ConversationAssistantsSection />
        </>
      ),
    },
    {
      id: "models",
      title: t("模型与能力", "Models & Capabilities"),
      description: t(
        "服务商端点、模型用途和各能力路由。",
        "Provider endpoints, model purposes, and routing for each capability.",
      ),
      icon: Bot,
      content: (
        <>
          <ProviderForm />
          <ModelRoutingSettingsSection />
          <SpeechRoutingSettingsSection />
          <VoiceRoutingSettingsSection />
          <ImageRoutingSettingsSection />
          <MemorySettingsSection />
        </>
      ),
    },
    {
      id: "media",
      title: t("媒体偏好", "Media Preferences"),
      description: t(
        "朗读声音与图片默认参数。",
        "Playback voice and default image parameters.",
      ),
      icon: Mic,
      content: (
        <>
          <VoiceOutputSettingsSection />
          <ImageGenerationSettingsSection />
        </>
      ),
    },
    {
      id: "data",
      title: t("数据与安全", "Data & Security"),
      description: t(
        "用量、备份、PIN 与本地数据重置。",
        "Usage, backup, PIN, and local data reset.",
      ),
      icon: Shield,
      content: (
        <>
          <UsageSettingsSection />
          <BackupSettingsSection />
          <PinSettingsSection />
        </>
      ),
    },
    {
      id: "about",
      title: t("关于", "About"),
      description: t(
        "应用版本与本地优先边界说明。",
        "Version info and local-first product boundaries.",
      ),
      icon: BookOpen,
      content: <AboutSection />,
    },
  ];

  useEffect(() => {
    if (!isPhone) {
      setSelectedGroupId((current) => current ?? "general");
    }
  }, [isPhone]);

  useEffect(() => {
    if (!settingsTargetGroupId) {
      return;
    }

    setSelectedGroupId(settingsTargetGroupId);
    clearSettingsTargetGroup();
  }, [clearSettingsTargetGroup, settingsTargetGroupId]);

  const selectedGroup =
    groups.find((group) => group.id === selectedGroupId) ?? groups[0];
  const headerTitle =
    isPhone && selectedGroupId ? selectedGroup.title : t("设置", "Settings");
  const headerSubtitle =
    isPhone && selectedGroupId
      ? selectedGroup.description
      : t(
          "按分组管理模型、助手与本地安全设置",
          "Manage models, assistants, and local security by group.",
        );

  function handleBack(): void {
    if (isPhone && selectedGroupId) {
      setSelectedGroupId(null);
      return;
    }

    onBack();
  }

  return (
    <div className={`pt-settings pt-settings--${layout}`}>
      <header
        className={`pt-pane-header ${
          isPhone ? "pt-pane-header--mobile" : "pt-pane-header--desktop pt-drag"
        }`}
        {...desktopDragProps}
      >
        {isPhone ? (
          <button
            type="button"
            className="pt-icon-button"
            onClick={handleBack}
            aria-label={t("返回", "Back")}
          >
            <ArrowLeft size={20} />
          </button>
        ) : (
          <div className="pt-pane-header__spacer" {...desktopDragProps} />
        )}

        <div
          className={`pt-pane-header__copy${isPhone ? " pt-pane-header__copy--center" : ""}`}
          {...desktopDragProps}
        >
          <p className="pt-pane-header__title" {...desktopDragProps}>
            {headerTitle}
          </p>
          <p className="pt-pane-header__subtitle" {...desktopDragProps}>
            {headerSubtitle}
          </p>
        </div>

        <div
          className="pt-pane-header__spacer"
          {...(isPhone ? { "data-no-drag": true } : desktopDragProps)}
        />
      </header>

      <div className="pt-settings__scroll">
        {isPhone && !selectedGroupId ? (
          <div className="pt-settings__column">
            <section className="pt-settings-section">
              <p className="pt-settings-section__title">{t("分组", "Groups")}</p>
              <div className="pt-settings-menu-card">
                {groups.map((group) => (
                  <SettingsMenuButton
                    key={group.id}
                    group={group}
                    active={false}
                    onClick={() => setSelectedGroupId(group.id)}
                  />
                ))}
              </div>
            </section>
          </div>
        ) : (
          <div className={`pt-settings-shell${isPhone ? " is-phone-detail" : ""}`}>
            {!isPhone ? (
              <aside className="pt-settings-menu">
                <div className="pt-settings-menu-card">
                  {groups.map((group) => (
                    <SettingsMenuButton
                      key={group.id}
                      group={group}
                      active={group.id === selectedGroup.id}
                      onClick={() => setSelectedGroupId(group.id)}
                    />
                  ))}
                </div>
              </aside>
            ) : null}

            <section className="pt-settings-panel">
              {!isPhone ? (
                <div className="pt-settings-panel__header">
                  <p className="pt-settings-panel__eyebrow">
                    {t("当前分组", "Current Group")}
                  </p>
                  <p className="pt-settings-panel__title">{selectedGroup.title}</p>
                  <p className="pt-settings-panel__detail">
                    {selectedGroup.description}
                  </p>
                </div>
              ) : null}

              <div className="pt-settings__column pt-settings__column--group">
                {selectedGroup.content}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsMenuButton({
  group,
  active,
  onClick,
}: {
  group: SettingsGroup;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = group.icon;

  return (
    <button
      type="button"
      className={`pt-settings-menu-button${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <div className="pt-settings-menu-button__icon">
        <Icon size={16} />
      </div>
      <div className="pt-settings-menu-button__copy">
        <p className="pt-settings-menu-button__title">{group.title}</p>
        <p className="pt-settings-menu-button__detail">{group.description}</p>
      </div>
      <ChevronRight size={16} className="pt-settings-menu-button__chevron" />
    </button>
  );
}

export function SettingsSection({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="pt-settings-section">
      <p className="pt-settings-section__title">{title}</p>
      <div className="pt-settings-card">{children}</div>
      {footer ? (
        <div className="pt-settings-section__footer">{footer}</div>
      ) : null}
    </section>
  );
}

function AboutSection() {
  const { t } = useI18n();

  return (
    <SettingsSection
      title={t("关于", "About")}
      footer={t(
        "Private Talk 是本地优先的 AI 聊天客户端。除非你主动把内容发送到已配置的模型端点，否则对话、服务商和 PIN 设置都会留在当前设备。",
        "Private Talk is a local AI chat client. Conversations, providers, and PIN settings stay on this device unless you explicitly send content to a configured model endpoint.",
      )}
    >
      <div className="pt-settings-row">
        <div className="pt-settings-row__copy">
          <p className="pt-settings-row__title">{t("版本", "Version")}</p>
        </div>
        <span className="pt-settings-row__value">0.1.0</span>
      </div>
    </SettingsSection>
  );
}
