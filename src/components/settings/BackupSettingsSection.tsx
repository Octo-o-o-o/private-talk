import { ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import * as api from "../../lib/tauri";
import { useAppStore } from "../../stores/appStore";
import type { ValidateBackupResult } from "../../lib/types";
import { Field, FormError, TextField, buttonStyles } from "./formControls";
import { SettingsSection } from "./SettingsPage";

function downloadBytes(fileName: string, data: number[]): void {
  const blob = new Blob([new Uint8Array(data)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function fileToByteArray(file: File): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) {
        reject(new Error("Unable to read backup data."));
        return;
      }
      resolve(Array.from(new Uint8Array(result)));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read backup file."));
    reader.readAsArrayBuffer(file);
  });
}

export function BackupSettingsSection() {
  const { t } = useI18n();
  const loadProviders = useAppStore((state) => state.loadProviders);
  const loadUiPreferences = useAppStore((state) => state.loadUiPreferences);
  const loadChatSettings = useAppStore((state) => state.loadChatSettings);
  const loadSpeechSettings = useAppStore((state) => state.loadSpeechSettings);
  const loadImageGenConfig = useAppStore((state) => state.loadImageGenConfig);
  const [expanded, setExpanded] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [selectedData, setSelectedData] = useState<number[] | null>(null);
  const [validation, setValidation] = useState<ValidateBackupResult | null>(null);
  const [loading, setLoading] = useState<"export" | "validate" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetFeedback(): void {
    setError(null);
    setSuccess(null);
  }

  async function refreshConfig(): Promise<void> {
    await Promise.all([
      loadProviders(),
      loadUiPreferences(),
      loadChatSettings(),
      loadSpeechSettings(),
      loadImageGenConfig(),
    ]);
  }

  async function handleExport(): Promise<void> {
    if (!exportPassword.trim()) {
      setError(t("请先输入导出密码。", "Enter an export password first."));
      return;
    }
    resetFeedback();
    setLoading("export");
    try {
      const result = await api.exportConfigData(exportPassword);
      downloadBytes(result.file_name, result.data);
      setSuccess(
        t(
          `已导出 ${result.providers} 个服务商和 ${result.settings} 项设置。`,
          `Exported ${result.providers} providers and ${result.settings} settings.`,
        ),
      );
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : t("导出备份失败。", "Failed to export backup."),
      );
    } finally {
      setLoading(null);
    }
  }

  async function handleValidate(): Promise<void> {
    if (!selectedData) {
      setError(t("先选择一个备份文件。", "Choose a backup file first."));
      return;
    }
    if (!importPassword.trim()) {
      setError(t("请输入备份密码。", "Enter the backup password."));
      return;
    }
    resetFeedback();
    setLoading("validate");
    try {
      const result = await api.validateBackupData(importPassword, selectedData);
      setValidation(result);
    } catch (validateError) {
      setValidation(null);
      setError(
        validateError instanceof Error
          ? validateError.message
          : t("验证备份失败。", "Failed to validate backup."),
      );
    } finally {
      setLoading(null);
    }
  }

  async function handleImport(): Promise<void> {
    if (!selectedData) {
      setError(t("先选择一个备份文件。", "Choose a backup file first."));
      return;
    }
    if (!importPassword.trim()) {
      setError(t("请输入备份密码。", "Enter the backup password."));
      return;
    }
    resetFeedback();
    setLoading("import");
    try {
      const result = await api.importConfigData(importPassword, selectedData, importMode);
      await refreshConfig();
      setSuccess(
        t(
          `已导入 ${result.providers} 个服务商和 ${result.settings} 项设置。`,
          `Imported ${result.providers} providers and ${result.settings} settings.`,
        ),
      );
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : t("导入备份失败。", "Failed to import backup."),
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <SettingsSection
      title={t("备份", "Backup")}
      footer={t(
        "当前只导出服务商和界面/模型相关设置，不包含对话内容、PIN 或本地附件文件。",
        "This backup currently exports providers and UI/model preferences only. It does not include conversations, PIN data, or local attachment files.",
      )}
    >
      <button
        type="button"
        className="pt-settings-row pt-settings-row--interactive"
        onClick={() => setExpanded((value) => !value)}
      >
        <div className="pt-settings-row__copy">
          <div className="pt-settings-row__title-line">
            <p className="pt-settings-row__title">{t("导出与恢复", "Export & Restore")}</p>
            <ChevronDown
              size={16}
              className={`pt-row-chevron${expanded ? " is-open" : ""}`}
            />
          </div>
          <p className="pt-settings-row__detail">
            {selectedFileName
              ? t(`待导入：${selectedFileName}`, `Ready to import: ${selectedFileName}`)
              : t("加密导出当前配置，并从备份恢复。", "Export encrypted settings and restore from backup.")}
          </p>
        </div>
      </button>

      {expanded ? (
        <div className="pt-settings-expand pt-settings-form">
          <div className="pt-backup-grid">
            <div className="pt-backup-card">
              <p className="pt-backup-card__title">{t("导出备份", "Export Backup")}</p>
              <TextField
                label={t("加密密码", "Encryption Password")}
                type="password"
                value={exportPassword}
                onChange={(event) => setExportPassword(event.target.value)}
                placeholder={t("至少自己能记住", "Something you will remember")}
              />
              <button
                type="button"
                className={buttonStyles.primary}
                onClick={() => void handleExport()}
                disabled={loading !== null}
              >
                {loading === "export" ? t("导出中...", "Exporting...") : t("下载备份", "Download Backup")}
              </button>
            </div>

            <div className="pt-backup-card">
              <p className="pt-backup-card__title">{t("导入备份", "Import Backup")}</p>
              <Field label={t("备份文件", "Backup File")}>
                <button
                  type="button"
                  className={buttonStyles.secondary}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {selectedFileName || t("选择备份文件", "Choose Backup File")}
                </button>
              </Field>
              <TextField
                label={t("备份密码", "Backup Password")}
                type="password"
                value={importPassword}
                onChange={(event) => setImportPassword(event.target.value)}
                placeholder={t("输入导出时设置的密码", "Enter the password used during export")}
              />
              <Field label={t("导入模式", "Import Mode")}>
                <select
                  className="pt-select"
                  value={importMode}
                  onChange={(event) => setImportMode(event.target.value as "merge" | "replace")}
                >
                  <option value="merge">{t("合并到当前配置", "Merge with current config")}</option>
                  <option value="replace">{t("替换当前配置", "Replace current config")}</option>
                </select>
              </Field>

              {validation ? (
                <div className="pt-backup-summary">
                  <span>{t(`${validation.providers} 个服务商`, `${validation.providers} providers`)}</span>
                  <span>{t(`${validation.settings} 项设置`, `${validation.settings} settings`)}</span>
                </div>
              ) : null}

              {validation?.has_local_config ? (
                <p className="pt-settings-help">
                  {importMode === "replace"
                    ? t(
                        "当前设备里已经有本地配置。Replace 会清空现有 provider 和相关设置后再导入。",
                        "This device already has local config. Replace will clear current providers and related settings before import.",
                      )
                    : t(
                        "当前设备里已经有本地配置。Merge 会在保留现有配置的前提下合并导入。",
                        "This device already has local config. Merge will import on top of the current setup.",
                      )}
                </p>
              ) : null}

              <div className="pt-settings-form__actions pt-settings-form__actions--start">
                <button
                  type="button"
                  className={buttonStyles.secondary}
                  onClick={() => void handleValidate()}
                  disabled={loading !== null}
                >
                  {loading === "validate" ? t("验证中...", "Validating...") : t("验证备份", "Validate Backup")}
                </button>
                <button
                  type="button"
                  className={buttonStyles.primary}
                  onClick={() => void handleImport()}
                  disabled={loading !== null || !validation}
                >
                  {loading === "import" ? t("导入中...", "Importing...") : t("导入备份", "Import Backup")}
                </button>
              </div>
            </div>
          </div>

          <FormError message={error} />
          {success ? <p className="pt-settings-help">{success}</p> : null}

          <input
            ref={fileInputRef}
            type="file"
            accept=".ptbackup,application/octet-stream"
            className="pt-compose__file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) {
                return;
              }
              resetFeedback();
              setValidation(null);
              setSelectedFileName(file.name);
              setSelectedData(null);
              void fileToByteArray(file)
                .then((data) => setSelectedData(data))
                .catch((readError) => {
                  setError(
                    readError instanceof Error
                      ? readError.message
                      : t("读取备份文件失败。", "Failed to read backup file."),
                  );
                });
            }}
          />
        </div>
      ) : null}
    </SettingsSection>
  );
}
