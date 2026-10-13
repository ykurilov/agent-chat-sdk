import type { DialogSoundsOptions, DialogSpeechOptions, DialogVoice } from "@ykurilov/agent-chat-voice-dialog/server";

/**
 * Голоса демо из библиотеки ElevenLabs (в своём приложении подставьте id голосов из своей библиотеки); первый — голос по умолчанию.
 *
 * `tags` — наборы тегов эмоций по характеру голоса (черновик по пробам из /tmp/019/tag-samples, пока на слух не проверен):
 * модель получает список текущего голоса, и «[softly]» не достаётся диктору, которому придыхание не идёт.
 */
export const demoVoices = [
  {
    id: "oE0n0S3wK5Mj9C62iehn",
    name: "Профессиональный диктор для аудиокниг",
    // Ровный, серьёзный голос: сдержанные эмоции; шёпот, придыхание, хохот и хрипы ему не идут.
    tags: {
      allowed: ["sighs", "curious", "thoughtful", "hesitant", "cautious", "worried", "sarcastic", "excited"],
      avoid: ["softly", "whispers", "laughs harder", "wheezing", "snorts", "crying"],
    },
  },
  {
    id: "B1cxry8r3a8ykrLjqkvS",
    name: "Рассказчик сказок",
    // Тёплый, театральный голос: шёпот, лукавство, тревога и угроза в сказке к месту.
    tags: {
      allowed: ["laughs", "whispers", "mischievously", "curious", "excited", "worried", "cautious", "threatening", "sighs", "warm, quiet voice"],
      avoid: ["wheezing", "snorts", "crying", "furious"],
    },
  },
  {
    id: "JyEaew7H7mwhutMPHSNz",
    name: "Старый пират",
    // Грубый, хриплый голос: смех, хрип, фырканье и угрозы его украшают; шёпот и придыхание — нет.
    tags: {
      allowed: ["laughs", "laughs harder", "wheezing", "snorts", "sighs", "exhales", "sarcastic", "mischievously", "threatening", "furious", "low, gravelly voice"],
      avoid: ["whispers", "softly", "crying"],
    },
  },
  {
    id: "K3V3yCKMVmZ9VGDe8sNP",
    name: "Женский голос",
    // Приятный понимающий голос с юмором: смех, вздох, любопытство, лёгкая ирония и мягкие описательные теги; угрозы и хрипы не нужны.
    tags: {
      allowed: ["laughs", "sighs", "curious", "excited", "thoughtful", "sarcastic", "mischievously", "worried", "hesitant", "softly", "warm, quiet voice"],
      avoid: ["threatening", "furious", "wheezing", "snorts", "crying"],
    },
  },
] as const satisfies readonly DialogVoice[];

/**
 * Цена озвучки за 1000 знаков в долларах для `eleven_v4_turbo`: тариф creator (22 $ за 100 000 единиц, 0,5 единицы на знак).
 * Предварительная, уточняется в живой проверке; `DEMO_SPEECH_PRICE_PER_1000_CHARS` задаёт свою.
 * `eleven_v4` стоит вдвое дороже.
 */
const defaultTurboPricePerThousandChars = 0.11;

/**
 * Настройки озвучки для демо (голоса и их теги — `demoVoices`, каталог голосов собирает демо-приложение). `DEMO_SPEECH_MODEL=eleven_v4` включает полную модель (по умолчанию быстрая `eleven_v4_turbo`).
 * Ключ ElevenLabs сюда не входит: он читается из `ELEVENLABS_API_KEY` на сервере.
 */
export function demoSpeechSettings(env: Record<string, string | undefined>): Pick<DialogSpeechOptions, "model" | "pricePerThousandChars"> {
  const configured = Number(env.DEMO_SPEECH_PRICE_PER_1000_CHARS);
  const turbo = Number.isFinite(configured) && configured > 0 ? configured : defaultTurboPricePerThousandChars;
  return {
    model: env.DEMO_SPEECH_MODEL === "eleven_v4" ? "eleven_v4" : "eleven_v4_turbo",
    pricePerThousandChars: { eleven_v4_turbo: turbo, eleven_v4: turbo * 2 },
  };
}

/**
 * Цена Scribe за час звука в долларах: ElevenLabs Scribe v2 (0,22 $ за час по документации ElevenLabs; v1 стоила 0,40 $).
 * `DEMO_SOUNDS_PRICE_PER_HOUR` задаёт свою.
 */
const defaultSoundsPricePerHour = 0.22;

/**
 * Звуки человека (смех, вздох) для демо: звук фразы параллельно уходит в Scribe, модель узнаёт о звуках пометкой.
 * `DEMO_SOUNDS=off` выключает. Ключ — тот же `ELEVENLABS_API_KEY` на сервере.
 */
export function demoSoundsSettings(env: Record<string, string | undefined>): Pick<DialogSoundsOptions, "pricePerHour"> | null {
  if (env.DEMO_SOUNDS === "off") return null;
  const configured = Number(env.DEMO_SOUNDS_PRICE_PER_HOUR);
  return { pricePerHour: Number.isFinite(configured) && configured > 0 ? configured : defaultSoundsPricePerHour };
}
