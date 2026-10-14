import { useCallback, useEffect, useRef, useState } from "react";
import { createDictationField } from "./dictation-field";
import type { DictationField } from "./dictation-field";
import { useChatLabels, voiceErrorText } from "./labels";
import type { VoiceInputView } from "./skin-contract";
import type { VoiceErrorDetails, VoiceErrorKind, VoiceInput, VoiceSession } from "./voice-input";

export interface UseVoiceDictationOptions {
  /** Нет голоса — нет и кнопки. */
  voice: VoiceInput | undefined;
  value: string;
  setValue: (value: string) => void;
  chatId: string;
}

type DictationState = VoiceInputView["state"];

export interface VoiceDictation {
  /** Что отдать полю ввода скина; `undefined` — голоса нет. */
  view: VoiceInputView | undefined;
  /** Бросить идущую диктовку (при отправке): поздние слова в поле не попадут. Без диктовки ничего не делает. */
  cancel: () => void;
}

/** Диктовка в поле ввода: состояние кнопки микрофона и запись слов в поле. */
export function useVoiceDictation({ voice, value, setValue, chatId }: UseVoiceDictationOptions): VoiceDictation {
  const labels = useChatLabels();
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<{ kind: VoiceErrorKind; details?: VoiceErrorDetails }>();
  const [polishing, setPolishing] = useState(false);
  const session = useRef<VoiceSession | null>(null);
  const field = useRef<DictationField | null>(null);
  // Номер диктовки: события брошенной диктовки не должны ничего менять.
  const run = useRef(0);
  const latestValue = useRef(value);
  const knownValue = useRef(value);
  // Что диктовка записала в поле, но React ещё не показал: рендеры приходят по порядку, и отстающий за правку руками не считается.
  const pendingWrites = useRef<string[]>([]);
  latestValue.current = value;

  const drop = useCallback(() => {
    run.current += 1;
    session.current?.cancel();
    session.current = null;
    field.current = null;
    setState("idle");
    setPolishing(false);
  }, []);

  // Поле изменилось не нашей записью: правка руками или отправка. Сообщение об ошибке больше не нужно.
  useEffect(() => {
    const ownWrite = pendingWrites.current.lastIndexOf(value);
    if (ownWrite >= 0) {
      pendingWrites.current.splice(0, ownWrite + 1);
      return;
    }
    pendingWrites.current = [];
    if (value === knownValue.current) return;
    knownValue.current = value;
    field.current?.observe(value);
    setError(undefined);
  }, [value]);

  // Уход с экрана и смена чата обрывают диктовку.
  useEffect(() => drop, [chatId, drop]);

  const start = useCallback(() => {
    if (!voice) return;
    const mine = ++run.current;
    const dictation = createDictationField(latestValue.current);
    field.current = dictation;
    knownValue.current = latestValue.current;
    pendingWrites.current = [];
    setError(undefined);
    setState("connecting");
    const alive = () => run.current === mine;
    session.current = voice.start(
      {
      onConnected: () => alive() && setState((current) => (current === "connecting" ? "listening" : current)),
      onText: (text) => {
        if (!alive()) return;
        const written = dictation.write(text);
        if (written === null) return;
        knownValue.current = written;
        pendingWrites.current.push(written);
        setValue(written);
      },
      onError: (kind, details) => alive() && setError({ kind, ...(details && { details }) }),
      onPolishing: () => {
        if (!alive()) return;
        dictation.freeze();
        setPolishing(true);
      },
      onPolished: (text) => {
        if (!alive()) return;
        // Заменяется только надиктованный кусок; если поле правили внутри него, чистка отбрасывается.
        const written = dictation.applyPolished(text);
        if (written === null) return;
        knownValue.current = written;
        pendingWrites.current.push(written);
        setValue(written);
      },
      onEnd: () => {
        if (!alive()) return;
        session.current = null;
        field.current = null;
        setState("idle");
        setPolishing(false);
      },
      },
      { chatId, ...(labels.locale && { language: labels.locale }) },
    );
  }, [voice, setValue, chatId, labels.locale]);

  const onToggle = useCallback(() => {
    if (state === "idle") start();
    else if (state === "connecting") drop();
    else if (state === "listening") {
      setState("stopping");
      session.current?.stop();
    }
  }, [state, start, drop]);

  const cancel = useCallback(() => {
    if (session.current) drop();
  }, [drop]);

  const view = voice
    ? { state, onToggle, ...(polishing && { polishing }), ...(error && { error: voiceErrorText(labels.voiceErrors, error.kind, error.details) }) }
    : undefined;
  return { view, cancel };
}
