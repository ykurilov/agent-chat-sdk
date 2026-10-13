const twoDigits = (value: number) => String(value).padStart(2, "0");

/** Секунды словами часов: 200 → «3:20», 3725 → «1:02:05». */
export function timeLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  return hours > 0 ? `${hours}:${twoDigits(minutes)}:${twoDigits(rest)}` : `${minutes}:${twoDigits(rest)}`;
}
