import type { Person, SandboxPeople } from "@ykurilov/agent-chat-sandbox";

/** Люди стенда для раздела «Чаты людей» песочницы: id — те же, что у входа на стенд (`demoUsers`). */
const demoPeople: Person[] = [
  { id: "anna", name: "Анна", hint: "anna@demo.local · админ" },
  { id: "boris", name: "Борис", hint: "boris@demo.local" },
];

/** Поиск людей стенда по имени, почте или id без учёта регистра. */
export const demoSandboxPeople: SandboxPeople = {
  find: async (query) => {
    const text = query.toLowerCase();
    return demoPeople.filter((person) => [person.id, person.name, person.hint].some((field) => field?.toLowerCase().includes(text)));
  },
};
