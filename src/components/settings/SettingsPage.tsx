import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import type { LayoutMode } from "../layout/useLayoutMode";
import { AssistantSettingsSection } from "./AssistantSettings";
import { AppearanceSettingsSection } from "./AppearanceSettings";
import { BackupSettingsSection } from "./BackupSettingsSection";
import { ConversationAssistantsSection } from "./ConversationAssistantsSection";
import { ImageGenerationSettingsSection } from "./ImageGenerationSettings";
import { LanguageSettingsSection } from "./LanguageSettings";
import { MemorySettingsSection } from "./MemorySettings";
import { ModelRoutingSettingsSection } from "./ModelRoutingSettings";
import { PinSettingsSection } from "./PinSettings";
import { ProviderForm } from "./ProviderForm";
import { SpeechSettingsSection } from "./SpeechSettings";
import { UsageSettingsSection } from "./UsageSettingsSection";
import { VoiceOutputSettingsSection } from "./VoiceOutputSettings";

interface SettingsPageProps {
  layout: LayoutMode;
  onBack: () => void;
}

export function SettingsPage({ layout, onBack }: SettingsPageProps) {
  const isPhone = layout === "phone";
  const { t } = useI18n();
  const desktopDragProps = !isPhone ? { "data-tauri-drag-region": true } : {};

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
            onClick={onBack}
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
            {t("设置", "Settings")}
          </p>
          <p className="pt-pane-header__subtitle" {...desktopDragProps}>
            {t(
              "模型、助手与本地安全设置",
              "Models, assistant, and local security",
            )}
          </p>
        </div>

        <div
          className="pt-pane-header__spacer"
          {...(isPhone ? { "data-no-drag": true } : desktopDragProps)}
        />
      </header>

      <div className="pt-settings__scroll">
        <div className="pt-settings__column">
          <LanguageSettingsSection />
          <AppearanceSettingsSection />
          <AssistantSettingsSection />
          <ConversationAssistantsSection />
          <ModelRoutingSettingsSection />
          <ImageGenerationSettingsSection />
          <MemorySettingsSection />
          <SpeechSettingsSection />
          <VoiceOutputSettingsSection />
          <ProviderForm />
          <UsageSettingsSection />
          <BackupSettingsSection />
          <PinSettingsSection />
          <AboutSection />
        </div>
      </div>
    </div>
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
