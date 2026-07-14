import type { Difficulty } from "@/lib/types";

export function getLearnerCommunicationGuidance(level: Difficulty) {
  if (level === "beginner") {
    return [
      "学习者是初学者。先用日常语言说明要做什么，再补充必要的技术名词。",
      "不要连续堆叠缩写或专业名词；首次出现的技术名词必须在同一句用括号解释。",
      "句子要短，操作要写清楚点哪里、看哪个文件、运行什么命令，以及看到什么才算成功。"
    ];
  }

  if (level === "intermediate") {
    return [
      "学习者是中级水平。主体仍使用容易理解的中文，可以使用常见技术名词，但首次出现时要用一句白话解释它的作用。",
      "不要只写架构名、协议名或工具名；每个名词都要落到这个仓库中具体要做的动作和可观察结果。",
      "避免学院式长句，优先使用“先做什么 → 再做什么 → 怎样确认成功”的表达。"
    ];
  }

  return [
    "学习者是进阶水平，可以直接使用准确的工程术语。",
    "重点说明模块边界、数据流、权衡、失败模式和验证策略，不需要把常见概念全部改写成大白话。",
    "即使使用专业表达，也必须给出仓库证据、具体动作和完成标准。"
  ];
}

export function shouldIncludeLearnerGlossary(level: Difficulty) {
  return level !== "advanced";
}
