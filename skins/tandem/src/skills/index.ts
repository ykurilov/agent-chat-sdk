import type { SkillsSkin } from "@ykurilov/agent-chat-skills/react";
import { TandemSkillEditor } from "./skill-editor";
import { TandemSkillList } from "./skill-list";
import { TandemSkillLoads } from "./skill-loads";
import { TandemSkillPanel } from "./skill-panel";
import { TandemSkillsLayout } from "./skills-layout";
import { TandemSkillsNotFound } from "./skills-not-found";
import { TandemSkillVersions } from "./skill-versions";

/** Скин экрана навыков (договор скина навыков, версия 1): для `SkillsAdmin`. */
export const tandemSkillsSkin: SkillsSkin = {
  SkillsLayout: TandemSkillsLayout,
  SkillList: TandemSkillList,
  SkillPanel: TandemSkillPanel,
  SkillEditor: TandemSkillEditor,
  SkillVersions: TandemSkillVersions,
  SkillLoads: TandemSkillLoads,
  SkillsNotFound: TandemSkillsNotFound,
};
