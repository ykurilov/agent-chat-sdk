import { useEffect, useState } from "react";
import type { SandboxSettingsResponse } from "../types";
import type { SandboxClient } from "./sandbox-client";
import { useSandboxLabels } from "./sandbox-labels";
import type { SandboxSkin } from "./sandbox-skin";

/** Предел длины инструкции песочного чата (как у сервера). */
export const MAX_INSTRUCTIONS_LENGTH = 100_000;

/** Правка инструкции открытого песочного чата; боевая рядом для сравнения. */
export function InstructionHeader({ skin, client, chatId }: { skin: SandboxSkin; client: SandboxClient; chatId: string }) {
  const labels = useSandboxLabels();
  const [settings, setSettings] = useState<SandboxSettingsResponse | null>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let current = true;
    setSettings(null);
    client.settings(chatId).then(
      (loaded) => {
        if (!current) return;
        setSettings(loaded);
        setValue(loaded.instructions ?? loaded.appInstructions);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [client, chatId]);

  if (!settings) return null;
  const saved = settings.instructions ?? settings.appInstructions;
  const dirty = value !== saved;
  const tooLong = value.length > MAX_INSTRUCTIONS_LENGTH;

  const save = async (instructions: string | null) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      const next = await client.saveSettings(chatId, instructions);
      setSettings(next);
      setValue(next.instructions ?? next.appInstructions);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const error = tooLong ? labels.instructionsTooLong(MAX_INSTRUCTIONS_LENGTH) : saveFailed ? labels.instructionsSaveFailed : undefined;
  return (
    <skin.InstructionEditor
      value={value}
      onValueChange={setValue}
      appInstructions={settings.appInstructions}
      edited={settings.instructions !== null}
      dirty={dirty}
      onSave={() => void save(value)}
      canSave={dirty && !tooLong && !saving}
      saving={saving}
      {...(settings.instructions !== null && !saving && { onReset: () => void save(null) })}
      open={open}
      onOpenChange={setOpen}
      {...(error && { error })}
      maxLength={MAX_INSTRUCTIONS_LENGTH}
    />
  );
}
