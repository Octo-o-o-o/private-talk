import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { LayoutMode } from "../layout/useLayoutMode";
import { PinSettingsSection } from "./PinSettings";
import { ProviderForm } from "./ProviderForm";

interface SettingsPageProps {
  layout: LayoutMode;
  onBack: () => void;
}

export function SettingsPage({ layout, onBack }: SettingsPageProps) {
  const isPhone = layout === "phone";

  return (
    <div className={`pt-settings pt-settings--${layout}`}>
      <header
        className={`pt-pane-header ${
          isPhone ? "pt-pane-header--mobile" : "pt-pane-header--desktop pt-drag"
        }`}
      >
        {isPhone ? (
          <button
            type="button"
            className="pt-icon-button"
            onClick={onBack}
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
        ) : (
          <div className="pt-pane-header__spacer" />
        )}

        <div className={`pt-pane-header__copy${isPhone ? " pt-pane-header__copy--center" : ""}`}>
          <p className="pt-pane-header__title">Settings</p>
          <p className="pt-pane-header__subtitle">
            Providers, security, and local device controls
          </p>
        </div>

        <div className="pt-pane-header__spacer" data-no-drag />
      </header>

      <div className="pt-settings__scroll">
        <div className="pt-settings__column">
          <ProviderForm />
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
  return (
    <SettingsSection
      title="About"
      footer="Private Talk is a local AI chat client. Conversations, providers, and PIN settings stay on this device unless you explicitly send content to a configured model endpoint."
    >
      <div className="pt-settings-row">
        <div className="pt-settings-row__copy">
          <p className="pt-settings-row__title">Version</p>
        </div>
        <span className="pt-settings-row__value">0.1.0</span>
      </div>
    </SettingsSection>
  );
}
