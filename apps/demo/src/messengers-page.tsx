import { MessengerConnect } from "@ykurilov/agent-chat-messengers/react";
import { tandemMessengersSkin } from "@ykurilov/agent-chat-skin-tandem/messengers";

const messengersApi = "/api/messengers";

/** Страница «Мессенджеры»: панель подключения Telegram. Грузится лениво: без неё код мессенджеров в сборку не попадает. */
export default function MessengersPage() {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-md">
        <MessengerConnect skin={tandemMessengersSkin} url={messengersApi} />
      </div>
    </div>
  );
}
