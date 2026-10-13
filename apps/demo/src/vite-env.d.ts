/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `0` — собрать демо без страницы песочницы (проверка, что её код не попадает в обычную сборку). */
  readonly VITE_DEMO_SANDBOX?: string;
  /** `0` — собрать демо без страницы мессенджеров (проверка, что их код не попадает в обычную сборку). */
  readonly VITE_DEMO_MESSENGERS?: string;
}
