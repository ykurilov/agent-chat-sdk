import { createContext, createElement, useContext } from "react";
import type { ReactNode } from "react";
import { russianFlowLabels, type FlowLabels } from "../labels/index";

const FlowLabelsContext = createContext<FlowLabels>(russianFlowLabels);

/** Надписи экранов сценария; по умолчанию русские (`russianFlowLabels`). */
export function FlowLabelsProvider({ labels, children }: { labels: FlowLabels; children: ReactNode }) {
  return createElement(FlowLabelsContext.Provider, { value: labels }, children);
}

export function useFlowLabels(): FlowLabels {
  return useContext(FlowLabelsContext);
}
