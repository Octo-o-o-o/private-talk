import { useAppStore } from "../../stores/appStore";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  mapping: Record<string, string | null>;
  onChange: (mapping: Record<string, string | null>) => void;
  readOnly?: boolean;
}

const DEFAULT_ROLES = ["narrator", "assistant"];

export function VoiceMappingEditor({ mapping, onChange, readOnly }: Props) {
  const { voices } = useAppStore();
  const [newRole, setNewRole] = useState("");
  const { t, tField } = useI18n();

  const roles = Object.keys(mapping);
  const allRoles = [...new Set([...DEFAULT_ROLES, ...roles])];

  const handleVoiceChange = (role: string, voiceId: string) => {
    onChange({ ...mapping, [role]: voiceId || null });
  };

  const handleAddRole = () => {
    if (newRole.trim() && !allRoles.includes(newRole.trim())) {
      onChange({ ...mapping, [newRole.trim()]: null });
      setNewRole("");
    }
  };

  const handleRemoveRole = (role: string) => {
    if (DEFAULT_ROLES.includes(role)) return;
    const next = { ...mapping };
    delete next[role];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <Label>{t("语音路由", "Voice Routing")}</Label>

      {allRoles.map((role) => (
        <div key={role} className="flex items-center gap-2.5">
          <span className="w-24 shrink-0 truncate text-sm font-medium text-foreground">{role}</span>
          <Select
            value={mapping[role] ?? "__none__"}
            onValueChange={(value) =>
              handleVoiceChange(role, value === "__none__" ? "" : value)
            }
            disabled={readOnly}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder={t("无", "None")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("无", "None")}</SelectItem>
              {voices.map((voice) => (
                <SelectItem key={voice.id} value={voice.id}>
                  {tField(voice.display_name, voice.display_name_en)} ({voice.engine})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!DEFAULT_ROLES.includes(role) && !readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => handleRemoveRole(role)}
              className="size-9 text-muted-foreground"
            >
              <X size={14} />
            </Button>
          )}
        </div>
      ))}

      {!readOnly && (
        <div className="flex items-center gap-2.5">
          <Input
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Enter") handleAddRole();
            }}
            placeholder={t("新增角色...", "Add a role...")}
            className="flex-1"
          />
          <Button
            type="button"
            onClick={handleAddRole}
            variant="outline"
            size="icon"
            disabled={!newRole.trim()}
          >
            <Plus size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}
