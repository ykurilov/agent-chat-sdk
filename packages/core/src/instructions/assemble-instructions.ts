import { diagramsInstructions } from "../widgets/diagrams-instructions";
import { liveDemosInstructions } from "../widgets/live-demos-instructions";

/** Служебные блоки ядра, которые дописываются к инструкции агента. */
export interface InstructionBlocks {
  /** Инструкция вложений. */
  attachments?: string;
  /** Строка про схемы. */
  diagrams?: boolean;
  /** Абзац про живые демонстрации. */
  liveDemos?: boolean;
  /** Инструкция долгой памяти. */
  memory?: string;
}

/** Сколько разных текстов базы помнит сборщик: инструкция песочного чата меняется редко, старые тексты вытесняются. */
const ASSEMBLED_LIMIT = 32;

/**
 * Инструкция агента со служебными блоками: вложения, схемы, демонстрации, память — по порядку, через перевод строки.
 * Блок, который уже есть в инструкции, не дублируется.
 */
export function assembleInstructions(base: string, blocks: InstructionBlocks): string {
  const extras = [blocks.attachments, blocks.diagrams ? diagramsInstructions : undefined, blocks.liveDemos ? liveDemosInstructions : undefined, blocks.memory];
  return extras.reduce<string>((instructions, extra) => (!extra || instructions.includes(extra) ? instructions : `${instructions}\n${extra}`), base);
}

/**
 * Сборка на ход для инструкции, заданной на чат: тот же текст базы — та же строка без пересборки
 * (начало запроса одно и то же — кэш модели не страдает).
 */
export function createInstructionsAssembler(blocks: InstructionBlocks): { forBase(base: string): string } {
  const assembled = new Map<string, string>();
  return {
    forBase(base) {
      const known = assembled.get(base);
      if (known !== undefined) return known;
      const instructions = assembleInstructions(base, blocks);
      if (assembled.size >= ASSEMBLED_LIMIT) assembled.delete(assembled.keys().next().value!);
      assembled.set(base, instructions);
      return instructions;
    },
  };
}
