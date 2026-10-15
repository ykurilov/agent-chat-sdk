// Вход `./react`: экран навыков для админа, договор его скина и надписи.
export { SkillsAdmin } from "./react/skills-admin";
export type { SkillsAdminProps } from "./react/skills-admin";
export { createSkillsClient, DEFAULT_SKILLS_BASE_PATH, SkillsRequestError } from "./react/skills-client";
export type { SkillListEntry, SkillsClient } from "./react/skills-client";
export { lineDiff } from "./react/line-diff";
export type { DiffLine } from "./react/line-diff";
export type {
  SkillEditorProps,
  SkillListItemView,
  SkillListProps,
  SkillLoadsProps,
  SkillLoadView,
  SkillPanelProps,
  SkillsLayoutProps,
  SkillsLoadState,
  SkillsSkin,
  SkillVersionsProps,
  SkillVersionView,
} from "./react/skills-skin";
export { englishSkillsLabels, russianSkillsLabels, SkillsLabelsProvider, useSkillsLabels } from "./react/skills-labels";
export type { SkillsLabels } from "./react/skills-labels";
export { SKILL_STATUSES } from "./types";
export type { SkillStatus } from "./types";
