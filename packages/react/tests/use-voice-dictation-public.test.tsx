// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
// Только публичный вход пакета: так подключает диктовку приложение со своим полем ввода.
import { useVoiceDictation } from "../src/index";
import type { UseVoiceDictationOptions, VoiceDictation, VoiceInput, VoiceListener } from "../src/index";

afterEach(cleanup);

function fakeVoice() {
  const sessions: Array<{ listener: VoiceListener; cancelled: boolean }> = [];
  const voice: VoiceInput = {
    start(listener) {
      const session = { listener, cancelled: false };
      sessions.push(session);
      return { stop: () => {}, cancel: () => void (session.cancelled = true) };
    },
  };
  return { voice, sessions };
}

/** Своё поле ввода приложения: без ChatWorkspace и без ChatLabelsProvider. */
function OwnComposer({ voice, onApi }: { voice: VoiceInput | undefined; onApi: (api: VoiceDictation) => void }) {
  const [text, setText] = useState("");
  const options: UseVoiceDictationOptions = { voice, value: text, setValue: setText, chatId: "chat-1" };
  const dictation = useVoiceDictation(options);
  onApi(dictation);
  return (
    <div>
      <textarea aria-label="поле" value={text} onChange={(event) => setText(event.target.value)} />
      {dictation.view && (
        <button data-testid="mic" data-state={dictation.view.state} data-polishing={String(Boolean(dictation.view.polishing))} onClick={dictation.view.onToggle} />
      )}
    </div>
  );
}

describe("useVoiceDictation из публичного входа пакета", () => {
  it("своё поле: слова диктовки попадают в textarea, подписи по умолчанию без провайдера", () => {
    const { voice, sessions } = fakeVoice();
    render(<OwnComposer voice={voice} onApi={() => {}} />);

    fireEvent.click(screen.getByTestId("mic"));
    expect(screen.getByTestId("mic").getAttribute("data-state")).toBe("connecting");
    act(() => sessions[0]!.listener.onConnected());
    expect(screen.getByTestId("mic").getAttribute("data-state")).toBe("listening");
    act(() => sessions[0]!.listener.onText({ finalText: "Привет", interimText: " мир" }));
    expect((screen.getByLabelText("поле") as HTMLTextAreaElement).value).toBe("Привет мир");
  });

  it("чистка видна как polishing, cancel бросает диктовку, поздние слова не пишутся", () => {
    const { voice, sessions } = fakeVoice();
    let api!: VoiceDictation;
    render(<OwnComposer voice={voice} onApi={(value) => (api = value)} />);

    fireEvent.click(screen.getByTestId("mic"));
    act(() => sessions[0]!.listener.onConnected());
    act(() => sessions[0]!.listener.onPolishing?.());
    expect(screen.getByTestId("mic").getAttribute("data-polishing")).toBe("true");

    act(() => api.cancel());
    expect(sessions[0]!.cancelled).toBe(true);
    act(() => sessions[0]!.listener.onText({ finalText: "поздно", interimText: "" }));
    expect((screen.getByLabelText("поле") as HTMLTextAreaElement).value).toBe("");
  });

  it("без voice кнопки нет", () => {
    render(<OwnComposer voice={undefined} onApi={() => {}} />);
    expect(screen.queryByTestId("mic")).toBeNull();
  });
});
