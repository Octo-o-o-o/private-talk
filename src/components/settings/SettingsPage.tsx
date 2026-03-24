import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  ChevronRight,
  Download,
  Globe,
  HardDrive,
  Loader2,
  Mic,
  Plus,
  Server,
  Settings,
  Shield,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as api from "@/lib/tauri";
import { useI18n } from "@/lib/i18n";
import {
  PROVIDER_PRESETS,
  createProviderModelsString,
  pickModelsForPreset,
  type ProviderPresetConfig,
} from "@/lib/providerPresets";
import type { DetectedLocalService, LocalOpenClawDetection, LocalProviderScanResult, OpenClawAgent, OpenClawInstance, Provider } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { MobileMenuButton } from "@/components/layout/MobileMenuButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

// Session-level flag: only show auto-detection dialog once per app session
const SETTINGS_VISITED_KEY = "private-talk-settings-visited";

type SettingsSection = "providers" | "memory" | "security" | "openclaw" | "stt" | "data";

type SettingsState = {
  hotWindowSize: number;
  maxContextMessages: number;
};

type ProviderFormState = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string;
};

function createEmptyProviderForm(): ProviderFormState {
  return {
    name: "",
    baseUrl: "",
    apiKey: "",
    models: "",
  };
}

function createProviderFormFromPreset(
  preset?: ProviderPresetConfig | null
): ProviderFormState {
  if (!preset) return createEmptyProviderForm();

  return {
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: "",
    models: createProviderModelsString(preset),
  };
}

function createProviderFormFromProvider(provider: Provider): ProviderFormState {
  return {
    name: provider.name,
    baseUrl: provider.base_url,
    apiKey: provider.api_key,
    models: provider.models.join(","),
  };
}

export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();
  const {
    providers,
    voices,
    assistants,
    pinEnabled,
    selectedSttProviderId,
    sttModel,
    loadProviders,
    setSelectedSttProvider,
    setSttModel,
    checkPinStatus,
    loadAssistants,
    loadVoices,
    loadConversations,
    pendingLocalDetections,
    localScanComplete,
    consumePendingDetection,
    dismissAllDetections,
    loadOpenClawInstances,
  } = useAppStore();

  const sectionParam = searchParams.get("section");
  const section: SettingsSection | null =
    sectionParam === "providers" ||
    sectionParam === "memory" ||
    sectionParam === "security" ||
    sectionParam === "openclaw" ||
    sectionParam === "stt" ||
    sectionParam === "data"
      ? sectionParam
      : null;
  const mode = searchParams.get("mode");
  const providerId = searchParams.get("providerId");
  const presetId = searchParams.get("preset");

  const editingProvider =
    providerId ? providers.find((provider) => provider.id === providerId) ?? null : null;
  const selectedPreset =
    PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? null;
  const isProviderCreate = section === "providers" && mode === "new";
  const isProviderEdit = section === "providers" && Boolean(providerId);
  const showLocalScanner = section === "providers" && (isProviderCreate || isProviderEdit);

  const [settings, setSettings] = useState<SettingsState>({
    hotWindowSize: 20,
    maxContextMessages: 100,
  });
  const [providerForm, setProviderForm] = useState<ProviderFormState>(createEmptyProviderForm);
  const [providerError, setProviderError] = useState("");
  const [providerNotice, setProviderNotice] = useState("");
  const [isAutoConfiguringProvider, setIsAutoConfiguringProvider] = useState(false);
  const [isScanningLocalProviders, setIsScanningLocalProviders] = useState(false);
  const [localScanResults, setLocalScanResults] = useState<LocalProviderScanResult[]>([]);
  const [localScanError, setLocalScanError] = useState("");
  const [sttProviderDraft, setSttProviderDraft] = useState<string>("system");
  const [sttModelDraft, setSttModelDraft] = useState("whisper-1");
  const [isSavingSttSettings, setIsSavingSttSettings] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [showReset, setShowReset] = useState(false);

  // OpenClaw state
  const [openclawInstances, setOpenclawInstances] = useState<OpenClawInstance[]>([]);
  const [openclawDetection, setOpenclawDetection] = useState<LocalOpenClawDetection | null>(null);
  const [isDetectingOpenclaw, setIsDetectingOpenclaw] = useState(false);
  const [openclawForm, setOpenclawForm] = useState({ name: "", gatewayUrl: "", token: "" });
  const [openclawFormError, setOpenclawFormError] = useState("");
  const [openclawTestAgents, setOpenclawTestAgents] = useState<OpenClawAgent[] | null>(null);
  const [isTestingOpenclaw, setIsTestingOpenclaw] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const [connectionStringError, setConnectionStringError] = useState("");
  const [connectionStringSuccess, setConnectionStringSuccess] = useState("");

  // Delete confirmation dialog state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingDeleteType, setPendingDeleteType] = useState<"provider" | "openclaw" | null>(null);

  const confirmDelete = (type: "provider" | "openclaw", id: string) => {
    setPendingDeleteType(type);
    setPendingDeleteId(id);
    setDeleteConfirmOpen(true);
  };

  const executeDelete = async () => {
    if (!pendingDeleteId || !pendingDeleteType) return;
    if (pendingDeleteType === "provider") {
      await handleDeleteProvider(pendingDeleteId);
    } else {
      await handleDeleteOpenClaw(pendingDeleteId);
    }
    setDeleteConfirmOpen(false);
    setPendingDeleteId(null);
    setPendingDeleteType(null);
  };

  // Auto-detection dialog state (results come from appStore, pre-scanned at startup)
  const [showDetectionDialog, setShowDetectionDialog] = useState(false);
  const [currentDetection, setCurrentDetection] = useState<DetectedLocalService | null>(null);
  const [dontRemindAgain, setDontRemindAgain] = useState(false);
  const detectionShownRef = useRef(false);

  useEffect(() => {
    const load = async () => {
      const [hotWindowResult, maxContextResult, instancesResult] = await Promise.allSettled([
        api.getSetting("context_hot_size"),
        api.getSetting("context_max_messages"),
        api.listOpenClawInstances(),
      ]);

      const hotWindow =
        hotWindowResult.status === "fulfilled" ? hotWindowResult.value : null;
      const maxContext =
        maxContextResult.status === "fulfilled" ? maxContextResult.value : null;
      setSettings({
        hotWindowSize: hotWindow ? Number(hotWindow) : 20,
        maxContextMessages: maxContext ? Number(maxContext) : 100,
      });

      if (instancesResult.status === "fulfilled") {
        setOpenclawInstances(instancesResult.value);
      } else {
        console.error("Failed to load OpenClaw instances:", instancesResult.reason);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    setSttProviderDraft(selectedSttProviderId ?? "system");
    setSttModelDraft(sttModel || "whisper-1");
  }, [selectedSttProviderId, sttModel]);

  // Auto-detect local OpenClaw when entering openclaw section
  useEffect(() => {
    if (section !== "openclaw") return;
    setIsDetectingOpenclaw(true);
    api.detectLocalOpenClaw().then((detection) => {
      setOpenclawDetection(detection);
      setIsDetectingOpenclaw(false);
    }).catch(() => setIsDetectingOpenclaw(false));
  }, [section]);

  // Show detection dialog instantly when entering settings dashboard (results already cached)
  useEffect(() => {
    if (section || detectionShownRef.current || !localScanComplete) return;
    if (pendingLocalDetections.length === 0) return;

    // Only show once per session
    const visited = sessionStorage.getItem(SETTINGS_VISITED_KEY);
    if (visited === "true") return;
    sessionStorage.setItem(SETTINGS_VISITED_KEY, "true");

    detectionShownRef.current = true;
    setCurrentDetection(pendingLocalDetections[0]);
    setShowDetectionDialog(true);
  }, [section, localScanComplete, pendingLocalDetections]);

  // Handle adding a detected service
  const handleAcceptDetection = async () => {
    if (!currentDetection) return;

    try {
      if (currentDetection.type === "provider" && currentDetection.providerScan) {
        const scan = currentDetection.providerScan;
        await api.createProvider(scan.name, scan.base_url, scan.api_key, scan.models);
        await loadProviders();
      } else if (currentDetection.type === "openclaw" && currentDetection.openclawDetection) {
        const detection = currentDetection.openclawDetection;
        const instance = await api.createOpenClawInstance(
          t("本地 OpenClaw", "Local OpenClaw"),
          detection.gateway_url ?? "ws://127.0.0.1:18789",
          detection.gateway_token ?? "",
          true, // skipCliCheck: gateway already confirmed running during detection
          false // isRemote: this is a local instance
        );
        setOpenclawInstances((prev) => [
          instance,
          ...prev.filter((item) => item.id !== instance.id),
        ]);
      }
    } catch {
      // Silently continue to next
    }

    consumePendingDetection(currentDetection.key);
    advanceDetectionDialog();
  };

  const handleSkipDetection = () => {
    if (!currentDetection) return;

    if (dontRemindAgain) {
      dismissAllDetections(true);
      setShowDetectionDialog(false);
      setDontRemindAgain(false);
      return;
    }

    consumePendingDetection(currentDetection.key);
    advanceDetectionDialog();
  };

  const advanceDetectionDialog = () => {
    // Get remaining detections from store (after consume)
    const remaining = useAppStore.getState().pendingLocalDetections;
    if (remaining.length > 0) {
      setCurrentDetection(remaining[0]);
      setDontRemindAgain(false);
    } else {
      setShowDetectionDialog(false);
      setCurrentDetection(null);
      setDontRemindAgain(false);
    }
  };

  useEffect(() => {
    if (section !== "providers") return;

    if (isProviderCreate) {
      setProviderError("");
      setProviderNotice("");
      setProviderForm(createProviderFormFromPreset(selectedPreset));
      return;
    }

    if (editingProvider) {
      setProviderError("");
      setProviderNotice("");
      setProviderForm(createProviderFormFromProvider(editingProvider));
    }
  }, [editingProvider, isProviderCreate, section, selectedPreset]);

  const statCards = useMemo(
    () => [
      {
        label: t("服务商", "Providers"),
        value: providers.length.toString(),
        status: t("就绪", "Ready"),
        icon: <Server className="h-4 w-4" />,
        onClick: () => updateView(setSearchParams, { section: "providers" }),
      },
      {
        label: t("声音", "Voices"),
        value: voices.length.toString(),
        status: t("就绪", "Ready"),
        icon: <Volume2 className="h-4 w-4" />,
        onClick: () => navigate("/voices"),
      },
      {
        label: t("助手", "Assistants"),
        value: assistants.length.toString(),
        status: t("就绪", "Ready"),
        icon: <Brain className="h-4 w-4" />,
        onClick: () => navigate("/assistants"),
      },
      {
        label: t("PIN 锁", "PIN Lock"),
        value: pinEnabled ? t("开启", "On") : t("关闭", "Off"),
        status: t("就绪", "Ready"),
        icon: <Shield className="h-4 w-4" />,
        onClick: () => updateView(setSearchParams, { section: "security" }),
      },
    ],
    [navigate, pinEnabled, providers.length, assistants.length, setSearchParams, t, voices.length]
  );

  const updateSettings = (next: Partial<SettingsState>) => {
    setSettings((prev) => ({ ...prev, ...next }));
  };

  const saveContextSettings = async () => {
    await Promise.all([
      api.setSetting("context_hot_size", String(settings.hotWindowSize)),
      api.setSetting("context_max_messages", String(settings.maxContextMessages)),
    ]);
  };

  const handleSaveSttSettings = async () => {
    setIsSavingSttSettings(true);
    try {
      await Promise.all([
        setSelectedSttProvider(
          sttProviderDraft === "system" ? null : sttProviderDraft
        ),
        setSttModel(sttModelDraft.trim() || "whisper-1"),
      ]);
    } finally {
      setIsSavingSttSettings(false);
    }
  };

  const openDashboard = () => {
    setSearchParams(new URLSearchParams());
  };

  const openProviderList = () => {
    updateView(setSearchParams, { section: "providers" });
  };

  const openProviderCreate = (preset?: ProviderPresetConfig | null) => {
    updateView(setSearchParams, {
      section: "providers",
      mode: "new",
      preset: preset?.id ?? null,
    });
  };

  const openProviderDetail = (id: string) => {
    updateView(setSearchParams, {
      section: "providers",
      providerId: id,
    });
  };

  const handleAutoConfigurePreset = async () => {
    if (!selectedPreset) return;

    setProviderError("");
    setProviderNotice("");

    if (selectedPreset.apiKeyRequired && !providerForm.apiKey.trim()) {
      setProviderError(
        t("请先填写 API Key，再执行自动配置。", "Enter an API key before running auto configuration.")
      );
      return;
    }

    setIsAutoConfiguringProvider(true);

    try {
      const discovery = await api.discoverProviderModels(
        providerForm.baseUrl.trim() || selectedPreset.baseUrl,
        providerForm.apiKey.trim() || null,
        selectedPreset.discoveryMode
      );
      const models = pickModelsForPreset(selectedPreset, discovery.models);

      setProviderForm((prev) => ({
        ...prev,
        name: prev.name.trim() || selectedPreset.name,
        baseUrl: prev.baseUrl.trim() || selectedPreset.baseUrl,
        models: models.join(","),
      }));
      setProviderNotice(
        t(
          `已自动发现 ${models.length} 个模型并填入表单。`,
          `Discovered ${models.length} models and filled the form automatically.`
        )
      );
    } catch (error) {
      setProviderForm((prev) => ({
        ...prev,
        name: prev.name.trim() || selectedPreset.name,
        baseUrl: prev.baseUrl.trim() || selectedPreset.baseUrl,
        models: selectedPreset.defaultModels.join(","),
      }));
      setProviderNotice(
        t(
          "自动发现失败，已回退到预设推荐模型列表。",
          "Discovery failed, so the form fell back to the preset's recommended model list."
        )
      );
    } finally {
      setIsAutoConfiguringProvider(false);
    }
  };

  const handleScanLocalProviders = async () => {
    setLocalScanError("");
    setProviderNotice("");
    setIsScanningLocalProviders(true);

    try {
      const results = await api.scanLocalProviders();
      setLocalScanResults(results);
      if (results.length === 0) {
        setLocalScanError(
          t(
            "未发现本地模型服务，请确认服务已启动。",
            "No local model services found. Ensure your service is running."
          )
        );
      }
    } catch (error) {
      setLocalScanError(
        t(
          "本地模型扫描失败，请稍后重试。",
          "Local model scanning failed. Try again in a moment."
        )
      );
    } finally {
      setIsScanningLocalProviders(false);
    }
  };

  const handleUseLocalScanResult = (result: LocalProviderScanResult) => {
    setProviderError("");
    setProviderNotice(
      t(
        `已根据 ${result.framework} 的扫描结果填写连接信息。`,
        `Filled the form from the ${result.framework} scan result.`
      )
    );
    setProviderForm({
      name: result.name,
      baseUrl: result.base_url,
      apiKey: result.api_key,
      models: result.models.join(","),
    });
  };

  const handleCreateOrUpdateProvider = async () => {
    setProviderError("");
    setProviderNotice("");

    if (!providerForm.name.trim() || !providerForm.baseUrl.trim()) {
      setProviderError(t("名称和 Base URL 不能为空。", "Name and Base URL are required."));
      return;
    }

    const models = providerForm.models
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (editingProvider) {
      await api.updateProvider(
        editingProvider.id,
        providerForm.name.trim(),
        providerForm.baseUrl.trim(),
        providerForm.apiKey.trim(),
        models
      );
    } else {
      await api.createProvider(
        providerForm.name.trim(),
        providerForm.baseUrl.trim(),
        providerForm.apiKey.trim(),
        models
      );
    }

    await loadProviders();
    setProviderForm(createEmptyProviderForm());
    openProviderList();
  };

  const handleDeleteProvider = async (id: string) => {
    await api.deleteProvider(id);
    await loadProviders();

    if (providerId === id) {
      openProviderList();
    }
  };

  const handleSetDefault = async (id: string) => {
    await api.setDefaultProvider(id);
    await loadProviders();
  };

  const handleEnablePin = async () => {
    setPinError("");
    if (newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
      setPinError(t("PIN 必须是 4-6 位数字。", "PIN must be 4-6 digits."));
      return;
    }
    if (newPin !== confirmPin) {
      setPinError(t("两次输入的 PIN 不一致。", "PINs do not match."));
      return;
    }
    await api.enablePin(newPin);
    await checkPinStatus();
    setNewPin("");
    setConfirmPin("");
  };

  const handleReset = async () => {
    await api.resetAllData();
    await checkPinStatus();
    await Promise.all([loadAssistants(), loadVoices(), loadConversations(), loadProviders()]);
    setShowReset(false);
  };

  // OpenClaw handlers
  const handleAddOpenClaw = async () => {
    const { name, gatewayUrl, token } = openclawForm;
    if (!name.trim() || !gatewayUrl.trim()) {
      setOpenclawFormError(t("名称和网关地址不能为空", "Name and gateway URL are required"));
      return;
    }
    try {
      setOpenclawFormError("");
      // Test connection before adding
      await api.listOpenClawAgents(gatewayUrl.trim(), token.trim());
    } catch (e) {
      setOpenclawFormError(
        t("连接测试失败，请检查网关地址和 Token 是否正确，以及 Gateway 是否正在运行。", "Connection test failed. Please check the gateway URL, token, and ensure the Gateway is running.") +
        "\n" + String(e)
      );
      return;
    }
    try {
      const instance = await api.createOpenClawInstance(
        name.trim(),
        gatewayUrl.trim(),
        token.trim()
      );
      setOpenclawInstances((prev) => [
        instance,
        ...prev.filter((item) => item.id !== instance.id),
      ]);
      setOpenclawForm({ name: "", gatewayUrl: "", token: "" });
      void loadOpenClawInstances();
    } catch (e) {
      setOpenclawFormError(String(e));
    }
  };

  const handleDeleteOpenClaw = async (id: string) => {
    await api.deleteOpenClawInstance(id);
    setOpenclawInstances((prev) => prev.filter((item) => item.id !== id));
    void loadOpenClawInstances();
  };

  const handleQuickAddLocalOpenClaw = async () => {
    if (!openclawDetection) return;
    try {
      const instance = await api.createOpenClawInstance(
        t("本地 OpenClaw", "Local OpenClaw"),
        openclawDetection.gateway_url ?? "ws://127.0.0.1:18789",
        openclawDetection.gateway_token ?? "",
        true, // skipCliCheck: gateway already confirmed running
        false // isRemote: local instance
      );
      setOpenclawInstances((prev) => [
        instance,
        ...prev.filter((item) => item.id !== instance.id),
      ]);
      void loadOpenClawInstances();
    } catch (e) {
      setOpenclawFormError(String(e));
    }
  };

  const handleTestOpenClaw = async (gatewayUrl: string, token: string, instanceId?: string) => {
    setIsTestingOpenclaw(true);
    setOpenclawTestAgents(null);
    try {
      const agents = await api.listOpenClawAgents(gatewayUrl, token, instanceId);
      setOpenclawTestAgents(agents);
    } catch (e) {
      setOpenclawFormError(String(e));
    }
    setIsTestingOpenclaw(false);
  };

  const handlePasteConnectionString = async () => {
    setConnectionStringError("");
    setConnectionStringSuccess("");
    const input = connectionString.trim();
    if (!input) {
      setConnectionStringError(t("请粘贴连接串", "Please paste a connection string"));
      return;
    }
    try {
      const payload = await api.parseConnectionString(input);
      const name = payload.name || t("远程 OpenClaw", "Remote OpenClaw");
      // Test connection before adding
      try {
        await api.listOpenClawAgents(payload.url, payload.token);
      } catch (e) {
        setConnectionStringError(
          t("连接测试失败，请检查远程 Gateway 是否正在运行，以及 SSH 隧道是否已建立。", "Connection test failed. Please check the remote Gateway is running and the SSH tunnel is established.") +
          "\n" + String(e)
        );
        return;
      }
      const agentsCache = payload.agents ? JSON.stringify(payload.agents.map(a => ({
        id: a.id, name: a.name, model: a.model, is_default: a.isDefault,
        emoji: null, avatar: null, description: null,
      }))) : undefined;
      const instance = await api.createOpenClawInstance(
        name,
        payload.url,
        payload.token,
        true, // skipCliCheck
        true, // isRemote
        agentsCache
      );
      setOpenclawInstances((prev) => [
        instance,
        ...prev.filter((item) => item.id !== instance.id),
      ]);
      setConnectionString("");
      setConnectionStringSuccess(
        payload.token
          ? t("已添加: ", "Added: ") + name
          : t("已添加（无 Token）: ", "Added (no token): ") + name
      );
      void loadOpenClawInstances();
    } catch (e) {
      setConnectionStringError(String(e));
    }
  };

  const pageHeading = getPageHeading(section, isProviderEdit, isProviderCreate, t);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-x-hidden bg-background">
      <div className="flex h-14 items-center gap-3 border-b border-border px-4 md:px-6">
        <MobileMenuButton />
        {section ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={openDashboard}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="flex items-center gap-3">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <div className="space-y-0.5 leading-none">
            <p className="text-xs uppercase tracking-wider leading-none text-muted-foreground">
              {t("偏好设置", "Preferences")}
            </p>
            <h1 className="text-lg font-semibold leading-none text-foreground">
              {t("设置", "Settings")}
            </h1>
          </div>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex min-h-full max-w-6xl flex-col p-4 md:p-6">
          <div className="mb-8">
            <h2 className="mb-2 text-2xl font-semibold text-foreground">{pageHeading.title}</h2>
            <p className="text-sm text-muted-foreground">{pageHeading.description}</p>
          </div>

          {!section ? (
            <>
              <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
                {statCards.map((card) => (
                  <StatCard key={card.label} {...card} />
                ))}
              </div>

              <div className="space-y-6">
                <ProviderStackCard
                  t={t}
                  providers={providers}
                  onOpenCreate={() => openProviderCreate()}
                  onOpenDetails={openProviderDetail}
                  onDelete={async (id) => {
                    confirmDelete("provider", id);
                  }}
                  onSetDefault={handleSetDefault}
                />

                <OpenClawSummaryCard
                  t={t}
                  instances={openclawInstances}
                  onOpenDetails={() => updateView(setSearchParams, { section: "openclaw" })}
                />

                <SpeechToTextCard
                  t={t}
                  providers={providers}
                  selectedSttProviderId={selectedSttProviderId}
                  sttModel={sttModel}
                  onOpenDetails={() => updateView(setSearchParams, { section: "stt" })}
                  draftProviderId={sttProviderDraft}
                  draftModel={sttModelDraft}
                  setDraftProviderId={setSttProviderDraft}
                  setDraftModel={setSttModelDraft}
                  onSave={handleSaveSttSettings}
                  isSaving={isSavingSttSettings}
                />

                <MemoryCard
                  t={t}
                  settings={settings}
                  onSettingsChange={updateSettings}
                  onSave={saveContextSettings}
                  onOpenDetails={() => updateView(setSearchParams, { section: "memory" })}
                />

                <DataManagementCard
                  t={t}
                  onOpenDetails={() => updateView(setSearchParams, { section: "data" })}
                />
              </div>
            </>
          ) : null}

          {section === "providers" ? (
            <div className="space-y-6">
              {!isProviderCreate && !isProviderEdit ? (
                <ProviderStackCard
                  t={t}
                  providers={providers}
                  onOpenCreate={() => openProviderCreate()}
                  onOpenDetails={openProviderDetail}
                  onDelete={async (id) => {
                    confirmDelete("provider", id);
                  }}
                  onSetDefault={handleSetDefault}
                />
              ) : null}

              {isProviderCreate || isProviderEdit ? (
                <Card>
                  <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
                    <div>
                      <CardTitle>
                        {isProviderEdit
                          ? t("编辑服务商", "Edit Provider")
                          : t("新建服务商", "Add Provider")}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {isProviderEdit
                          ? t("更新连接参数。", "Update connection parameters.")
                          : t("选择预设或自行填写。", "Pick a preset or fill manually.")}
                      </CardDescription>
                    </div>
                    <Button variant="ghost" size="sm" onClick={openProviderList} className="self-start">
                      {t("返回列表", "Back to list")}
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="font-medium">{t("快速预设", "Quick Presets")}</h4>
                        {selectedPreset ? (
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{selectedPreset.name}</Badge>
                            <Badge variant="outline">
                              {selectedPreset.category === "local"
                                ? t("本地", "Local")
                                : t("云端", "Cloud")}
                            </Badge>
                          </div>
                        ) : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "选择后预填端点和模型，支持一键自动发现。",
                          "Selection pre-fills endpoint and models; supports auto-discovery."
                        )}
                      </p>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {PROVIDER_PRESETS.map((preset) => (
                          <EndpointPreset
                            key={preset.id}
                            name={preset.name}
                            url={preset.baseUrl}
                            description={t(preset.description.zh, preset.description.en)}
                            category={preset.category}
                            selected={selectedPreset?.id === preset.id}
                            onSelect={() => openProviderCreate(preset)}
                          />
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {t("自定义兼容端点", "Custom Compatible Endpoint")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t(
                              "其他 OpenAI 兼容服务可从空白表单开始。",
                              "For other OpenAI-compatible endpoints not listed above."
                            )}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" className="shrink-0" onClick={() => openProviderCreate()}>
                          {t("空白创建", "Start Blank")}
                        </Button>
                      </div>
                    </div>

                    {showLocalScanner ? (
                      <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="font-medium">{t("扫描本地模型", "Scan Local Models")}</h4>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {t(
                                "探测本地端口上的 OpenAI 兼容服务。",
                                "Probes OpenAI-compatible services on localhost."
                              )}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0"
                            onClick={() => void handleScanLocalProviders()}
                            disabled={isScanningLocalProviders}
                          >
                            {isScanningLocalProviders
                              ? t("扫描中…", "Scanning...")
                              : t("开始扫描", "Scan now")}
                          </Button>
                        </div>

                        {localScanResults.length > 0 ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            {localScanResults.map((result) => (
                              <button
                                key={`${result.base_url}-${result.framework}`}
                                type="button"
                                onClick={() => handleUseLocalScanResult(result)}
                                className="rounded-lg border border-border bg-background p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className="font-medium">{result.name}</p>
                                  <Badge variant="outline">{result.framework}</Badge>
                                </div>
                                <p className="mt-1 font-mono text-xs text-muted-foreground">
                                  {result.base_url}
                                </p>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {result.models.length > 0
                                    ? t(
                                        `${result.models.length} 个模型，首个: ${result.models[0]}`,
                                        `${result.models.length} models, first: ${result.models[0]}`
                                      )
                                    : t(
                                        "已识别服务，暂无模型返回。",
                                        "Service detected, no models returned."
                                      )}
                                </p>
                                <p className="mt-2 text-[11px] text-muted-foreground">
                                  {result.detection}
                                </p>
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {localScanError ? (
                          <p className="text-sm text-muted-foreground">{localScanError}</p>
                        ) : null}
                      </div>
                    ) : null}

                    {isProviderEdit && !editingProvider ? (
                      <Card className="border-destructive/40">
                        <CardContent className="p-4 text-sm text-destructive">
                          {t("未找到对应的服务商。", "The selected provider could not be found.")}
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-4">
                        {selectedPreset ? (
                          <div className="rounded-lg border border-border bg-muted/20 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h4 className="font-medium">{selectedPreset.name}</h4>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {t(selectedPreset.description.zh, selectedPreset.description.en)}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                onClick={() => void handleAutoConfigurePreset()}
                                disabled={
                                  isAutoConfiguringProvider ||
                                  (selectedPreset.apiKeyRequired && !providerForm.apiKey.trim())
                                }
                              >
                                {isAutoConfiguringProvider
                                  ? t("配置中…", "Configuring...")
                                  : selectedPreset.apiKeyRequired
                                    ? t("填 Key 后自动配置", "Auto configure")
                                    : t("自动发现模型", "Discover models")}
                              </Button>
                            </div>
                            <p className="mt-3 text-xs text-muted-foreground">
                              {selectedPreset.apiKeyRequired
                                ? t(
                                    "填写 Key 后自动拉取模型列表，失败则回退到推荐模型。",
                                    "Fetches model list with your key; falls back to recommended models on failure."
                                  )
                                : t(
                                    "无需 API Key，点击按钮探测本地模型。",
                                    "No API key needed; probes localhost for available models."
                                  )}
                            </p>
                          </div>
                        ) : null}

                        <div className="grid gap-3 md:grid-cols-2">
                          <div>
                            <Label className="text-sm text-muted-foreground">
                              {t("名称", "Name")}
                            </Label>
                            <Input
                              className="mt-1"
                              value={providerForm.name}
                              onChange={(event) =>
                                setProviderForm((prev) => ({
                                  ...prev,
                                  name: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div>
                            <Label className="text-sm text-muted-foreground">
                              {t("Base URL", "Base URL")}
                            </Label>
                            <Input
                              className="mt-1"
                              value={providerForm.baseUrl}
                              onChange={(event) =>
                                setProviderForm((prev) => ({
                                  ...prev,
                                  baseUrl: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Label className="text-sm text-muted-foreground">
                              {t("API Key", "API Key")}
                            </Label>
                            <Input
                              type="password"
                              className="mt-1"
                              value={providerForm.apiKey}
                              placeholder={
                                selectedPreset?.apiKeyPlaceholder ||
                                t("可选，取决于服务端配置", "Optional, depending on the server")
                              }
                              onChange={(event) =>
                                setProviderForm((prev) => ({
                                  ...prev,
                                  apiKey: event.target.value,
                                }))
                              }
                            />
                          </div>
                          <div className="md:col-span-2">
                            <Label className="text-sm text-muted-foreground">
                              {t("模型列表", "Models")}
                            </Label>
                            <Input
                              className="mt-1"
                              value={providerForm.models}
                              onChange={(event) =>
                                setProviderForm((prev) => ({
                                  ...prev,
                                  models: event.target.value,
                                }))
                              }
                              placeholder="gpt-5-mini,deepseek-chat,qwen3:8b"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {providerNotice ? (
                      <p className="text-sm text-muted-foreground">{providerNotice}</p>
                    ) : null}

                    {providerError ? (
                      <p className="text-sm text-destructive">{providerError}</p>
                    ) : null}

                    {(isProviderCreate || editingProvider) ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                        <div className="flex flex-wrap items-center gap-2">
                          {editingProvider && !editingProvider.is_default ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void handleSetDefault(editingProvider.id)}
                            >
                              <Check className="mr-1.5 h-3.5 w-3.5" />
                              {t("设为默认", "Set default")}
                            </Button>
                          ) : null}
                          {editingProvider ? (
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => confirmDelete("provider", editingProvider.id)}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              {t("删除", "Delete")}
                            </Button>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={openProviderList}>
                            {t("取消", "Cancel")}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void handleCreateOrUpdateProvider()}
                            disabled={
                              (Boolean(providerId) && !editingProvider) ||
                              !providerForm.name.trim() ||
                              !providerForm.baseUrl.trim()
                            }
                          >
                            {isProviderEdit
                              ? t("保存服务商", "Save Provider")
                              : t("创建服务商", "Create Provider")}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          ) : null}

          {section === "memory" ? (
            <MemoryCard
              t={t}
              settings={settings}
              standalone
              onSettingsChange={updateSettings}
              onSave={saveContextSettings}
            />
          ) : null}

          {section === "stt" ? (
            <SpeechToTextCard
              t={t}
              providers={providers}
              selectedSttProviderId={selectedSttProviderId}
              sttModel={sttModel}
              standalone
              draftProviderId={sttProviderDraft}
              draftModel={sttModelDraft}
              setDraftProviderId={setSttProviderDraft}
              setDraftModel={setSttModelDraft}
              onSave={handleSaveSttSettings}
              isSaving={isSavingSttSettings}
            />
          ) : null}

          {section === "security" ? (
            <SecurityCard
              t={t}
              standalone
              pinEnabled={pinEnabled}
              newPin={newPin}
              confirmPin={confirmPin}
              pinError={pinError}
              showReset={showReset}
              setNewPin={setNewPin}
              setConfirmPin={setConfirmPin}
              setShowReset={setShowReset}
              onEnablePin={handleEnablePin}
              onReset={handleReset}
            />
          ) : null}

          {section === "data" ? (
            <DataManagementSection
              t={t}
              loadProviders={loadProviders}
              loadAssistants={loadAssistants}
              loadVoices={loadVoices}
              loadOpenClawInstances={loadOpenClawInstances}
            />
          ) : null}

          {section === "openclaw" ? (
            <div className="space-y-6">
              {/* Local detection banner */}
              {isDetectingOpenclaw ? (
                <Card>
                  <CardContent className="flex items-center gap-3 py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">
                      {t("正在检测本地 OpenClaw...", "Detecting local OpenClaw...")}
                    </span>
                  </CardContent>
                </Card>
              ) : openclawDetection?.gateway_running &&
                !openclawInstances.some((inst) => {
                  // Compare by port to detect the same local instance regardless of URL format
                  const detectedPort = openclawDetection.gateway_url?.match(/:(\d+)/)?.[1];
                  const instancePort = inst.gateway_url.match(/:(\d+)/)?.[1];
                  return detectedPort && instancePort && detectedPort === instancePort;
                }) ? (
                <Card className="border-emerald-500/30 bg-emerald-500/5">
                  <CardContent className="flex items-center justify-between py-4">
                    <div>
                      <p className="font-medium text-emerald-700 dark:text-emerald-300">
                        {t("检测到本地 OpenClaw Gateway", "Local OpenClaw Gateway detected")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {openclawDetection.cli_version ?? ""} &middot; {openclawDetection.gateway_url}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => void handleQuickAddLocalOpenClaw()}>
                      {t("一键添加", "Quick Add")}
                    </Button>
                  </CardContent>
                </Card>
              ) : openclawDetection?.cli_available ? (
                <Card className="border-amber-500/30 bg-amber-500/5">
                  <CardContent className="py-4">
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      {t(
                        "OpenClaw CLI 已安装，但 Gateway 未运行。",
                        "OpenClaw CLI installed but Gateway not running."
                      )}
                    </p>
                  </CardContent>
                </Card>
              ) : null}

              {/* Instance list */}
              {openclawInstances.length > 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t("已配置的 Gateway", "Configured Gateways")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {openclawInstances.map((instance) => (
                      <div
                        key={instance.id}
                        className="flex items-center justify-between rounded-lg border border-border p-3"
                      >
                        <div>
                          <p className="font-medium">{instance.name}</p>
                          {!/^wss?:\/\/(localhost|127\.0\.0\.1|::1)(:|\/|$)/i.test(instance.gateway_url) ? (
                            <p className="text-xs text-muted-foreground">{instance.gateway_url}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isTestingOpenclaw}
                            onClick={() => void handleTestOpenClaw(instance.gateway_url, instance.token, instance.id)}
                          >
                            {isTestingOpenclaw ? (
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                            ) : null}
                            {t("测试连接", "Test")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => confirmDelete("openclaw", instance.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}

              {/* Test results */}
              {openclawTestAgents !== null ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t("可用 Agents", "Available Agents")} ({openclawTestAgents.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {openclawTestAgents.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("未发现 Agents", "No agents found")}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {openclawTestAgents.map((agent) => (
                          <div key={agent.id} className="rounded-lg border border-border p-3">
                            <p className="font-medium">{agent.name}</p>
                            <p className="text-xs text-muted-foreground">{agent.model}</p>
                            <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">{agent.id}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : null}

              {/* Connection string quick-add */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("快速添加远程 Gateway", "Quick Add Remote Gateway")}</CardTitle>
                  <CardDescription>
                    {t(
                      "连接运行在远程服务器上的 OpenClaw 实例，无需手动填写地址和密钥。",
                      "Connect to a remote OpenClaw instance without manually entering URL and token."
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                    <p className="text-sm font-medium">
                      {t("使用方法", "How to use")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "1. 在远程 OpenClaw 服务器上运行以下命令：",
                        "1. Run this command on the remote OpenClaw server:"
                      )}
                    </p>
                    <code className="block rounded bg-background px-3 py-2 font-mono text-xs select-all">
                      npx private-talk-pair
                    </code>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "2. 将生成的连接串（以 ptalk: 开头）粘贴到下方，点击添加即可。",
                        "2. Copy the generated connection string (starts with ptalk:) and paste it below."
                      )}
                    </p>
                  </div>
                  <Input
                    value={connectionString}
                    onChange={(e) => {
                      setConnectionString(e.target.value);
                      setConnectionStringError("");
                      setConnectionStringSuccess("");
                    }}
                    placeholder="ptalk:eyJ2IjoxLCJ1cmwiOiJ3czovLy..."
                    className="font-mono text-sm"
                  />
                  {connectionStringError ? (
                    <p className="text-sm text-destructive">{connectionStringError}</p>
                  ) : null}
                  {connectionStringSuccess ? (
                    <p className="text-sm text-emerald-600 dark:text-emerald-400">{connectionStringSuccess}</p>
                  ) : null}
                  <Button onClick={() => void handlePasteConnectionString()}>
                    {t("添加", "Add")}
                  </Button>
                </CardContent>
              </Card>

              {/* Add form */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("手动添加 Gateway", "Add Gateway Manually")}</CardTitle>
                  <CardDescription>
                    {t("填写连接信息。", "Enter connection details.")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("名称", "Name")}</Label>
                    <Input
                      value={openclawForm.name}
                      onChange={(e) => setOpenclawForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder={t("例如：我的 OpenClaw", "e.g. My OpenClaw")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("Gateway URL", "Gateway URL")}</Label>
                    <Input
                      value={openclawForm.gatewayUrl}
                      onChange={(e) => setOpenclawForm((f) => ({ ...f, gatewayUrl: e.target.value }))}
                      placeholder="ws://127.0.0.1:18789"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Token</Label>
                    <Input
                      type="password"
                      value={openclawForm.token}
                      onChange={(e) => setOpenclawForm((f) => ({ ...f, token: e.target.value }))}
                      placeholder={t("可选", "Optional")}
                    />
                  </div>
                  {openclawFormError ? (
                    <p className="text-sm text-destructive">{openclawFormError}</p>
                  ) : null}
                  <Button onClick={() => void handleAddOpenClaw()}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t("添加", "Add")}
                  </Button>
                </CardContent>
              </Card>
            </div>
          ) : null}

          <div className="mt-auto border-t border-border pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">
                  Private Talk <span className="font-normal text-muted-foreground">v0.1.0</span>
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    "本地优先的 AI 聊天客户端。",
                    "Local-first AI chat client."
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{t("桌面工作区", "Desktop workspace")}</Badge>
                <Badge variant="outline">{t("数据仅本地", "Local data only")}</Badge>
                <Badge variant="outline">{t("多服务商就绪", "Multi-provider ready")}</Badge>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingDeleteType === "provider"
                ? t("删除服务商？", "Delete provider?")
                : t("删除 OpenClaw 连接？", "Delete OpenClaw connection?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDeleteType === "provider"
                ? t(
                    "此操作将永久删除该服务商配置，无法撤销。",
                    "This will permanently delete this provider configuration. This action cannot be undone."
                  )
                : t(
                    "此操作将永久删除该 OpenClaw 连接配置，无法撤销。",
                    "This will permanently delete this OpenClaw connection. This action cannot be undone."
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void executeDelete()}>
              {t("确认删除", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Auto-detection dialog — results pre-scanned at app startup, shown instantly */}
      <AlertDialog open={showDetectionDialog} onOpenChange={setShowDetectionDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("发现本地服务", "Local Service Detected")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {currentDetection ? (
                  <>
                    <p>
                      {t(
                        `扫描到本地的 ${currentDetection.framework}，是否将其添加到应用中？`,
                        `A local ${currentDetection.framework} instance was detected. Add it to the app?`
                      )}
                    </p>
                    <div className="rounded-lg border border-border bg-muted/30 p-3">
                      <p className="font-medium text-foreground">
                        {currentDetection.name}
                      </p>
                      <p className="mt-1 font-mono text-xs">
                        {currentDetection.detail}
                      </p>
                      {currentDetection.providerScan?.models.length ? (
                        <p className="mt-1 text-xs">
                          {t(
                            `${currentDetection.providerScan.models.length} 个模型可用`,
                            `${currentDetection.providerScan.models.length} models available`
                          )}
                        </p>
                      ) : null}
                    </div>
                    {pendingLocalDetections.length > 1 ? (
                      <p className="text-xs text-muted-foreground">
                        {t(
                          `还有 ${pendingLocalDetections.length - 1} 个待确认`,
                          `${pendingLocalDetections.length - 1} more to review`
                        )}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-3 sm:flex-col">
            <div className="flex items-center gap-2 self-start">
              <Checkbox
                id="dont-remind"
                checked={dontRemindAgain}
                onCheckedChange={(checked) => setDontRemindAgain(checked === true)}
              />
              <label htmlFor="dont-remind" className="cursor-pointer text-sm text-muted-foreground">
                {t("不再提醒", "Don't remind me again")}
              </label>
            </div>
            <div className="flex w-full justify-end gap-2">
              <Button variant="outline" onClick={handleSkipDetection}>
                {t("跳过", "Skip")}
              </Button>
              <Button onClick={() => void handleAcceptDetection()}>
                {t("添加", "Add")}
              </Button>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProviderStackCard({
  t,
  providers,
  onOpenCreate,
  onOpenDetails,
  onDelete,
  onSetDefault,
}: {
  t: (zh: string, en: string) => string;
  providers: Provider[];
  onOpenCreate: () => void;
  onOpenDetails: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onSetDefault: (id: string) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="flex items-start gap-3">
          <Server className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {t("模型路由", "Model Routing")}
            </p>
            <CardTitle className="text-lg">{t("服务商栈", "Provider Stack")}</CardTitle>
            <CardDescription className="mt-1">
              {t(
                "管理端点，选择默认路由。",
                "Manage endpoints and set default routing."
              )}
            </CardDescription>
          </div>
        </div>

        <Button size="sm" className="self-start shrink-0" onClick={onOpenCreate}>
          <Plus className="mr-1 h-4 w-4" />
          {t("新增服务商", "Add Provider")}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {providers.length > 0 ? (
          <div className="space-y-3">
            {providers.map((provider) => (
              <ProviderRow
                key={provider.id}
                t={t}
                provider={provider}
                onOpenDetails={() => onOpenDetails(provider.id)}
                onDelete={() => void onDelete(provider.id)}
                onSetDefault={() => void onSetDefault(provider.id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
            {t(
              "暂无服务商，从预设或自定义端点开始。",
              "No providers yet. Start from a preset or custom endpoint."
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpenClawSummaryCard({
  t,
  instances,
  onOpenDetails,
}: {
  t: (zh: string, en: string) => string;
  instances: OpenClawInstance[];
  onOpenDetails: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="flex items-start gap-3">
          <Globe className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              OpenClaw
            </p>
            <CardTitle className="text-lg">
              {t("Gateway 实例", "Gateway Instances")}
            </CardTitle>
            <CardDescription className="mt-1">
              {t("管理 OpenClaw Gateway 连接。", "Manage OpenClaw Gateway connections.")}
            </CardDescription>
          </div>
        </div>
        <Button variant="outline" size="sm" className="self-start shrink-0" onClick={onOpenDetails}>
          {t("管理", "Manage")}
          <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </CardHeader>
      {instances.length > 0 ? (
        <CardContent className="space-y-2">
          {instances.map((instance) => (
            <div
              key={instance.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
            >
              <div className="flex items-center gap-3">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{instance.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{instance.gateway_url}</p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          ))}
        </CardContent>
      ) : (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t("暂无 Gateway 实例。", "No gateway instances configured.")}
          </p>
        </CardContent>
      )}
    </Card>
  );
}

function SpeechToTextCard({
  t,
  providers,
  selectedSttProviderId,
  sttModel,
  draftProviderId,
  draftModel,
  setDraftProviderId,
  setDraftModel,
  onSave,
  isSaving,
  standalone,
  onOpenDetails,
}: {
  t: (zh: string, en: string) => string;
  providers: Provider[];
  selectedSttProviderId: string | null;
  sttModel: string;
  draftProviderId: string;
  draftModel: string;
  setDraftProviderId: (value: string) => void;
  setDraftModel: (value: string) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
  standalone?: boolean;
  onOpenDetails?: () => void;
}) {
  const selectedProvider = providers.find(
    (provider) => provider.id === selectedSttProviderId
  );
  const isSystemDefault = selectedSttProviderId === null;
  const isDirty =
    draftProviderId !== (selectedSttProviderId ?? "system") ||
    draftModel.trim() !== (sttModel || "whisper-1");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <Mic className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("语音转写", "Speech To Text")}
              </p>
              <div className="flex items-center gap-2">
                <Badge variant={isSystemDefault ? "secondary" : "outline"}>
                  {isSystemDefault
                    ? t("系统原生", "System native")
                    : selectedProvider?.name ?? t("独立 Provider", "Dedicated provider")}
                </Badge>
                {!standalone && onOpenDetails ? (
                  <Button variant="ghost" size="sm" onClick={onOpenDetails}>
                    {t("详情", "Details")}
                  </Button>
                ) : null}
              </div>
            </div>
            <CardTitle className="text-lg">{t("语音转文字", "Speech To Text")}</CardTitle>
            <CardDescription className="mt-1">
              {t(
                "未配置时优先使用系统原生语音识别；配置独立 Provider 后优先走 Provider，失败时自动回退到系统原生识别，必要时再回退到运行时识别。",
                "Uses native system speech recognition by default. When a dedicated provider is configured, it is preferred and falls back to native system recognition, then runtime recognition if needed."
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("STT 路由", "STT Route")}</Label>
            <Select value={draftProviderId} onValueChange={setDraftProviderId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">
                  {t("系统原生识别", "Native system recognition")}
                </SelectItem>
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t(
                "聊天模型和转写模型已分离，这里只影响录音转文字与语音消息转写。",
                "Chat routing and transcription routing are separated. This only affects voice-to-text and voice message transcription."
              )}
            </p>
          </div>
          <div className="space-y-2">
            <Label>{t("STT 模型", "STT Model")}</Label>
            <Input
              value={draftModel}
              onChange={(event) => setDraftModel(event.target.value)}
              placeholder="whisper-1"
              disabled={draftProviderId === "system"}
            />
            <p className="text-xs text-muted-foreground">
              {draftProviderId === "system"
                ? t(
                    "系统原生识别不需要模型名；该字段会在切换到独立 Provider 时生效。",
                    "Native system recognition does not need a model name; this field applies when a dedicated provider is selected."
                  )
                : t(
                    "用于 OpenAI 兼容 transcription 接口，例如 whisper-1。",
                    "Used for OpenAI-compatible transcription endpoints, for example whisper-1."
                  )}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          {draftProviderId === "system"
            ? t(
                "当前策略：优先使用系统原生语音识别；如果当前平台额外暴露了运行时识别能力，它只会作为最后兜底。",
                "Current strategy: prefer native system speech recognition; if the current runtime also exposes speech recognition, it is only used as the last fallback."
              )
            : t(
                "当前策略：先调用所选 STT Provider；如果调用失败则自动回退到系统原生识别，必要时再回退到运行时识别。",
                "Current strategy: call the selected STT provider first; if it fails, fall back to native system recognition, then runtime recognition if needed."
              )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
              {t(
                "macOS / iOS 会使用 Speech.framework，Windows 会使用 Windows.Media.SpeechRecognition，Android 会使用 android.speech.SpeechRecognizer；只有系统原生链路不可用时，才会退回到运行时识别。",
                "macOS / iOS use Speech.framework, Windows uses Windows.Media.SpeechRecognition, and Android uses android.speech.SpeechRecognizer. Runtime recognition is only used when the native system path is unavailable."
              )}
          </p>
          <Button
            size="sm"
            disabled={!isDirty || isSaving}
            onClick={() => void onSave()}
          >
            {isSaving ? t("保存中…", "Saving...") : t("保存更改", "Save changes")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MemoryCard({
  t,
  settings,
  standalone,
  onSettingsChange,
  onSave,
  onOpenDetails,
}: {
  t: (zh: string, en: string) => string;
  settings: SettingsState;
  standalone?: boolean;
  onSettingsChange: (next: Partial<SettingsState>) => void;
  onSave: () => Promise<void>;
  onOpenDetails?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <Brain className="mt-0.5 h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                {t("记忆预算", "Memory Budget")}
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("2 个控制项", "2 controls")}</span>
                {!standalone && onOpenDetails ? (
                  <Button variant="ghost" size="sm" onClick={onOpenDetails}>
                    {t("详情", "Details")}
                  </Button>
                ) : null}
              </div>
            </div>
            <CardTitle className="text-lg">{t("上下文压缩", "Context Compression")}</CardTitle>
            <CardDescription className="mt-1">
              {t(
                "控制热窗口大小和上下文消息上限。",
                "Control hot window size and max context messages."
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 md:gap-6">
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{settings.hotWindowSize}</span>
              <span className="text-xs text-muted-foreground">{t("热窗口", "Hot Window")}</span>
            </div>
            <Slider
              value={[settings.hotWindowSize]}
              onValueChange={([value]) => onSettingsChange({ hotWindowSize: value })}
              min={5}
              max={50}
              step={1}
            />
            <p className="text-xs text-muted-foreground">
              {t("窗口内的消息不会被压缩。", "Messages in this window are sent uncompressed.")}
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{settings.maxContextMessages}</span>
              <span className="text-xs text-muted-foreground">{t("上下文上限", "Max Context")}</span>
            </div>
            <Input
              type="number"
              value={settings.maxContextMessages}
              onChange={(event) =>
                onSettingsChange({
                  maxContextMessages: Number.parseInt(event.target.value, 10) || 100,
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              {t("超过阈值后旧消息会被摘要压缩。", "Older messages are summarized once this limit is reached.")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {t("压缩只影响旧历史，置顶消息单独保留。", "Only old history is compressed; pinned messages are preserved.")}
          </p>
          <Button size="sm" className="shrink-0" onClick={() => void onSave()}>{t("保存更改", "Save changes")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SecurityCard({
  t,
  pinEnabled,
  newPin,
  confirmPin,
  pinError,
  showReset,
  standalone,
  setNewPin,
  setConfirmPin,
  setShowReset,
  onEnablePin,
  onReset,
  onOpenDetails,
}: {
  t: (zh: string, en: string) => string;
  pinEnabled: boolean;
  newPin: string;
  confirmPin: string;
  pinError: string;
  showReset: boolean;
  standalone?: boolean;
  setNewPin: (value: string) => void;
  setConfirmPin: (value: string) => void;
  setShowReset: (value: boolean) => void;
  onEnablePin: () => Promise<void>;
  onReset: () => Promise<void>;
  onOpenDetails?: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("本地安全", "Local Security")}
          </p>
          <div className="flex items-center gap-2">
            <Badge variant={pinEnabled ? "default" : "secondary"}>
              {pinEnabled ? t("已启用", "Enabled") : t("已禁用", "Disabled")}
            </Badge>
            {!standalone && onOpenDetails ? (
              <Button variant="ghost" size="sm" onClick={onOpenDetails}>
                {t("详情", "Details")}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Shield className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">PIN Lock</CardTitle>
            <CardDescription className="mt-1">
              {t(
                "启动时需输入 PIN 解锁，PIN 仅存于本地。",
                "Require PIN to unlock on launch. PIN is stored locally only."
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm">
            {t(
              `PIN 保护当前${pinEnabled ? "已开启" : "已关闭"}。`,
              `PIN protection is currently ${pinEnabled ? "on" : "off"}.`
            )}
          </span>
          <Switch checked={pinEnabled} onCheckedChange={() => undefined} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            "开启后需解锁才能进入工作区。",
            "When enabled, unlock is required before entering the workspace."
          )}
        </p>

        <Separator />

        <div className="space-y-3">
          <div>
            <Label className="text-xs uppercase text-muted-foreground">
              {t("新 PIN（4-6 位）", "New PIN (4-6 digits)")}
            </Label>
            <Input
              type="password"
              value={newPin}
              onChange={(event) =>
                setNewPin(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="••••"
              maxLength={6}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs uppercase text-muted-foreground">
              {t("确认 PIN", "Confirm PIN")}
            </Label>
            <Input
              type="password"
              value={confirmPin}
              onChange={(event) =>
                setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="••••"
              maxLength={6}
              className="mt-1"
            />
          </div>
          {pinError ? <p className="text-sm text-destructive">{pinError}</p> : null}
          <Button
            className="w-full"
            disabled={!newPin || !confirmPin || newPin !== confirmPin}
            onClick={() => void onEnablePin()}
          >
            {t("启用 PIN", "Enable PIN")}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <p className="text-xs font-medium uppercase tracking-wider">{t("恢复", "Recovery")}</p>
          </div>
          <p className="text-lg font-medium">{t("危险区域", "Danger Zone")}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              "PIN 丢失只能通过清空所有本地数据恢复。",
              "Lost PIN can only be recovered by clearing all local data."
            )}
          </p>
          {!showReset ? (
            <Button
              variant="link"
              className="h-auto p-0 text-sm text-destructive"
              onClick={() => setShowReset(true)}
            >
              {t("忘记 PIN？准备完整重置", "Forgot PIN? Prepare full reset")}
            </Button>
          ) : (
            <div className="space-y-2">
              <Button variant="destructive" onClick={() => void onReset()}>
                {t("重置全部数据", "Reset everything")}
              </Button>
              <Button variant="ghost" onClick={() => setShowReset(false)}>
                {t("取消", "Cancel")}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DataManagementCard({
  t,
  onOpenDetails,
}: {
  t: (zh: string, en: string) => string;
  onOpenDetails: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            {t("数据管理", "Data Management")}
          </p>
          <Button variant="ghost" size="sm" onClick={onOpenDetails}>
            {t("详情", "Details")}
          </Button>
        </div>
        <div className="flex items-start gap-3">
          <HardDrive className="mt-0.5 h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">
              {t("导出与导入", "Export & Import")}
            </CardTitle>
            <CardDescription className="mt-1">
              {t(
                "跨设备迁移服务商、声音、助手等配置。导出文件使用密码加密保护。",
                "Migrate providers, voices, assistants across devices. Export files are password-encrypted."
              )}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={onOpenDetails}>
            <Download className="mr-2 h-4 w-4" />
            {t("导出配置", "Export")}
          </Button>
          <Button variant="outline" size="sm" onClick={onOpenDetails}>
            <Upload className="mr-2 h-4 w-4" />
            {t("导入配置", "Import")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DataManagementSection({
  t,
  loadProviders,
  loadAssistants,
  loadVoices,
  loadOpenClawInstances,
}: {
  t: (zh: string, en: string) => string;
  loadProviders: () => Promise<void>;
  loadAssistants: () => Promise<void>;
  loadVoices: () => Promise<void>;
  loadOpenClawInstances: () => Promise<void>;
}) {
  const [exportPassword, setExportPassword] = useState("");
  const [exportConfirmPassword, setExportConfirmPassword] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importValidation, setImportValidation] = useState<{
    providers: number;
    voices: number;
    assistants: number;
    openclaw_instances: number;
    settings: number;
    has_local_config: boolean;
  } | null>(null);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [exportResult, setExportResult] = useState("");
  const [importResult, setImportResult] = useState("");
  const [exportError, setExportError] = useState("");
  const [importError, setImportError] = useState("");

  const handleExport = async () => {
    if (exportPassword.length < 4) {
      setExportError(t("密码至少需要 4 个字符。", "Password must be at least 4 characters."));
      return;
    }
    if (exportPassword !== exportConfirmPassword) {
      setExportError(t("两次输入的密码不一致。", "Passwords do not match."));
      return;
    }
    setIsExporting(true);
    setExportError("");
    setExportResult("");
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const defaultName = `private-talk-backup-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.ptbackup`;
      const filePath = await save({
        defaultPath: defaultName,
        filters: [{ name: "Private Talk Backup", extensions: ["ptbackup"] }],
      });
      if (!filePath) {
        setExportResult(t("已取消导出。", "Export cancelled."));
        return;
      }
      const result = await api.exportConfig(exportPassword, filePath);
      const summary = [
        result.providers > 0
          ? t(`${result.providers} 个服务商`, `${result.providers} provider(s)`)
          : null,
        result.voices > 0
          ? t(`${result.voices} 个声音`, `${result.voices} voice(s)`)
          : null,
        result.assistants > 0
          ? t(`${result.assistants} 个助手`, `${result.assistants} assistant(s)`)
          : null,
        result.openclaw_instances > 0
          ? t(
              `${result.openclaw_instances} 个 OpenClaw`,
              `${result.openclaw_instances} OpenClaw instance(s)`
            )
          : null,
      ]
        .filter(Boolean)
        .join(t("、", ", "));
      setExportResult(
        t(`导出成功：${summary}`, `Exported: ${summary}`)
      );
      setExportPassword("");
      setExportConfirmPassword("");
    } catch (e) {
      setExportError(String(e));
    } finally {
      setIsExporting(false);
    }
  };

  const handleSelectFile = async () => {
    setImportError("");
    setImportResult("");
    setImportValidation(null);
    setImportPassword("");
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const filePath = await open({
        multiple: false,
        filters: [{ name: "Private Talk Backup", extensions: ["ptbackup"] }],
      });
      if (!filePath) return;
      const name = filePath.split(/[/\\]/).pop() ?? filePath;
      setImportFilePath(filePath);
      setImportFileName(name);
    } catch (e) {
      setImportError(String(e));
    }
  };

  const handleValidateAndImport = async () => {
    if (!importFilePath || !importPassword) return;
    setIsValidating(true);
    setImportError("");
    try {
      const validation = await api.validateBackup(importPassword, importFilePath);
      setImportValidation(validation);
      if (validation.has_local_config) {
        // Show merge/replace dialog
        setShowMergeDialog(true);
      } else {
        // No local config, import directly (merge mode)
        await doImport("merge");
      }
    } catch (e) {
      setImportError(String(e));
    } finally {
      setIsValidating(false);
    }
  };

  const doImport = async (mode: "merge" | "replace") => {
    if (!importFilePath || !importPassword) return;
    setShowMergeDialog(false);
    setIsImporting(true);
    setImportError("");
    try {
      const result = await api.importConfig(importPassword, importFilePath, mode);
      const summary = [
        result.providers > 0
          ? t(`${result.providers} 个服务商`, `${result.providers} provider(s)`)
          : null,
        result.voices > 0
          ? t(`${result.voices} 个声音`, `${result.voices} voice(s)`)
          : null,
        result.assistants > 0
          ? t(`${result.assistants} 个助手`, `${result.assistants} assistant(s)`)
          : null,
        result.openclaw_instances > 0
          ? t(
              `${result.openclaw_instances} 个 OpenClaw`,
              `${result.openclaw_instances} OpenClaw instance(s)`
            )
          : null,
        result.settings > 0
          ? t(`${result.settings} 项设置`, `${result.settings} setting(s)`)
          : null,
      ]
        .filter(Boolean)
        .join(t("、", ", "));
      setImportResult(
        t(`导入成功：${summary}`, `Imported: ${summary}`)
      );
      setImportPassword("");
      setImportFilePath(null);
      setImportFileName("");
      setImportValidation(null);
      // Refresh all stores
      await Promise.all([
        loadProviders(),
        loadAssistants(),
        loadVoices(),
        loadOpenClawInstances(),
      ]);
    } catch (e) {
      setImportError(String(e));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Export */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Download className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">
                {t("导出配置", "Export Configuration")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t(
                  "将服务商、声音、助手和 OpenClaw 配置导出为加密文件（.ptbackup）。",
                  "Export providers, voices, assistants, and OpenClaw configuration to an encrypted file (.ptbackup)."
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                {t("加密密码", "Encryption Password")}
              </Label>
              <Input
                type="password"
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
                placeholder={t("至少 4 个字符", "At least 4 characters")}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs uppercase text-muted-foreground">
                {t("确认密码", "Confirm Password")}
              </Label>
              <Input
                type="password"
                value={exportConfirmPassword}
                onChange={(e) => setExportConfirmPassword(e.target.value)}
                placeholder={t("再次输入密码", "Re-enter password")}
                className="mt-1"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "请牢记此密码。导入时需要使用相同的密码解密。",
              "Remember this password. You will need it to decrypt when importing."
            )}
          </p>
          {exportError ? (
            <p className="text-sm text-destructive">{exportError}</p>
          ) : null}
          {exportResult ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{exportResult}</p>
          ) : null}
          <Button
            onClick={() => void handleExport()}
            disabled={isExporting || !exportPassword || !exportConfirmPassword}
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {isExporting
              ? t("导出中…", "Exporting...")
              : t("选择位置并导出", "Choose Location & Export")}
          </Button>
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Upload className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-lg">
                {t("导入配置", "Import Configuration")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t(
                  "从 .ptbackup 文件导入配置。",
                  "Import configuration from a .ptbackup file."
                )}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Step 1: Select file */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => void handleSelectFile()}
              disabled={isImporting}
            >
              <Upload className="mr-2 h-4 w-4" />
              {t("选择备份文件", "Choose Backup File")}
            </Button>
            {importFileName && (
              <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                {importFileName}
              </span>
            )}
          </div>

          {/* Step 2: Enter password (shown after file selected) */}
          {importFilePath && (
            <div className="space-y-3">
              <div className="max-w-sm">
                <Label className="text-xs uppercase text-muted-foreground">
                  {t("解密密码", "Decryption Password")}
                </Label>
                <Input
                  type="password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder={t("输入导出时设置的密码", "Enter the export password")}
                  className="mt-1"
                />
              </div>
              <Button
                onClick={() => void handleValidateAndImport()}
                disabled={isImporting || isValidating || !importPassword}
              >
                {isValidating || isImporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {isValidating
                  ? t("验证中…", "Validating...")
                  : isImporting
                    ? t("导入中…", "Importing...")
                    : t("开始导入", "Import")}
              </Button>
            </div>
          )}

          {importError ? (
            <p className="text-sm text-destructive">{importError}</p>
          ) : null}
          {importResult ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{importResult}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Merge/Replace Dialog */}
      <AlertDialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("选择导入方式", "Choose Import Mode")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "检测到本地已有配置数据。请选择导入方式：",
                "Existing local configuration detected. Choose how to import:"
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {importValidation && (
            <p className="text-sm text-muted-foreground px-1">
              {t("备份文件包含：", "Backup contains: ")}
              {[
                importValidation.providers > 0
                  ? t(`${importValidation.providers} 个服务商`, `${importValidation.providers} provider(s)`)
                  : null,
                importValidation.voices > 0
                  ? t(`${importValidation.voices} 个声音`, `${importValidation.voices} voice(s)`)
                  : null,
                importValidation.assistants > 0
                  ? t(`${importValidation.assistants} 个助手`, `${importValidation.assistants} assistant(s)`)
                  : null,
                importValidation.openclaw_instances > 0
                  ? t(`${importValidation.openclaw_instances} 个 OpenClaw`, `${importValidation.openclaw_instances} OpenClaw`)
                  : null,
              ]
                .filter(Boolean)
                .join(t("、", ", "))}
            </p>
          )}
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={() => setShowMergeDialog(false)}>
              {t("取消", "Cancel")}
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => void doImport("merge")}
            >
              {t("与当前配置合并", "Merge with Current")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void doImport("replace")}
            >
              {t("替换当前配置", "Replace Current")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Info */}
      <Card className="border-muted">
        <CardContent className="py-4">
          <p className="text-xs text-muted-foreground">
            {t(
              "导出内容包括：所有服务商（含 API Key）、自定义声音、自定义助手、OpenClaw 实例、界面偏好设置。不包含：会话记录、聊天消息、PIN 设置。文件使用 AES-256-GCM 加密，密钥由 PBKDF2 从密码派生。",
              "Exported data includes: all providers (including API keys), custom voices, custom assistants, OpenClaw instances, UI preferences. Excluded: conversations, messages, PIN settings. Files are encrypted with AES-256-GCM, key derived via PBKDF2."
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  status,
  onClick,
}: {
  label: string;
  value: string;
  status: string;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  const isShortValue = value.length <= 3;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/20"
    >
      <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={isShortValue ? "text-3xl font-semibold" : "text-lg font-semibold"}>{value}</p>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{status}</p>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </button>
  );
}

function ProviderRow({
  t,
  provider,
  onOpenDetails,
  onDelete,
  onSetDefault,
}: {
  t: (zh: string, en: string) => string;
  provider: Provider;
  onOpenDetails: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetails}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpenDetails();
        }
      }}
      className="flex w-full items-center gap-4 rounded-lg border border-border bg-muted/50 p-4 text-left transition-colors hover:border-primary/30 hover:bg-muted"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary">
        {inferProviderGlyph(provider.name)}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{provider.name}</span>
          {provider.is_default ? (
            <Badge className="bg-primary/20 text-primary hover:bg-primary/30">
              {t("默认", "Default")}
            </Badge>
          ) : null}
        </div>
        <p className="font-mono text-xs text-muted-foreground">{provider.base_url}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(
            `${provider.models.length} 个模型：${provider.models[0] ?? "无模型"}`,
            `${provider.models.length} model${provider.models.length > 1 ? "s" : ""}: ${
              provider.models[0] ?? "No models"
            }`
          )}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {!provider.is_default ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onSetDefault();
            }}
          >
            <Check className="mr-1 h-4 w-4" />
            {t("设为默认", "Set Default")}
          </Button>
        ) : null}
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
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

function EndpointPreset({
  name,
  url,
  description,
  category,
  selected,
  onSelect,
}: {
  name: string;
  url: string;
  description: string;
  category: "cloud" | "local";
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/50",
        selected ? "border-primary/50 bg-primary/5" : "border-border"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{name}</p>
          <Badge variant="outline" className="text-[10px] uppercase">
            {category}
          </Badge>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground">{url}</p>
      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

function updateView(
  setSearchParams: ReturnType<typeof useSearchParams>[1],
  next: {
    section?: SettingsSection | null;
    mode?: string | null;
    providerId?: string | null;
    preset?: string | null;
  }
) {
  const params = new URLSearchParams();

  if (next.section) params.set("section", next.section);
  if (next.mode) params.set("mode", next.mode);
  if (next.providerId) params.set("providerId", next.providerId);
  if (next.preset) params.set("preset", next.preset);

  setSearchParams(params);
}

function inferProviderGlyph(name: string): ReactNode {
  const normalized = name.toLowerCase();
  if (normalized.includes("anthropic")) return <Brain className="h-4 w-4" />;
  return <Server className="h-4 w-4" />;
}

function getPageHeading(
  section: SettingsSection | null,
  isProviderEdit: boolean,
  isProviderCreate: boolean,
  t: (zh: string, en: string) => string
): { title: string; description: string } {
  if (section === "providers") {
    if (isProviderEdit) {
      return {
        title: t("服务商详情", "Provider Details"),
        description: t("编辑端点、Key 和模型列表。", "Edit endpoint, key, and model list."),
      };
    }
    if (isProviderCreate) {
      return {
        title: t("新增服务商", "Add Provider"),
        description: t("从预设或自定义端点开始。", "Start from a preset or custom endpoint."),
      };
    }
    return {
      title: t("服务商列表", "Provider Stack"),
      description: t("管理所有模型端点。", "Manage all model endpoints."),
    };
  }

  if (section === "memory") {
    return {
      title: t("上下文压缩", "Context Compression"),
      description: t("调整压缩窗口和上下文上限。", "Adjust compression window and context limit."),
    };
  }

  if (section === "stt") {
    return {
      title: t("语音转文字", "Speech To Text"),
      description: t("独立配置转写 Provider 与系统回退。", "Configure a dedicated transcription provider and system fallback."),
    };
  }

  if (section === "security") {
    return {
      title: t("本地安全", "Local Security"),
      description: t("PIN 锁与数据重置。", "PIN lock and data reset."),
    };
  }

  if (section === "data") {
    return {
      title: t("数据管理", "Data Management"),
      description: t("导出和导入配置数据，方便跨设备迁移。", "Export and import configuration data for cross-device migration."),
    };
  }

  if (section === "openclaw") {
    return {
      title: t("OpenClaw Gateways", "OpenClaw Gateways"),
      description: t("管理 OpenClaw Gateway 实例。", "Manage OpenClaw Gateway instances."),
    };
  }

  return {
    title: t("工作区设置", "Workspace Settings"),
    description: t("服务商、上下文与隐私控制。", "Providers, context, and privacy controls."),
  };
}
