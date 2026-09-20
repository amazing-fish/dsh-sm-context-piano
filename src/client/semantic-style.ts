/** Speaker colours survive active/hover states, with semantic text as a non-colour cue. */
import type { PianoLanguage } from '../core/config.ts'
import type { PianoItem } from './navigation-model.ts'

export const SEMANTIC_CSS = `
.smcp-unified .smcp-bar[data-role="user"] {
  --smcp-key: var(--smcp-user-color, #2563eb);
  --smcp-key-active: var(--smcp-user-active-color, #1d4ed8);
  color: var(--smcp-key);
}
.smcp-unified .smcp-bar[data-role="assistant"] {
  --smcp-key: var(--smcp-assistant-color, #7c3aed);
  --smcp-key-active: var(--smcp-assistant-active-color, #6d28d9);
  color: var(--smcp-key);
}
/* Semantic kinds override the broad speaker palette where meaning is more useful. */
.smcp-unified .smcp-bar[data-kind="output"] {
  --smcp-key: var(--smcp-output-color, #8a8a8a);
  --smcp-key-active: var(--smcp-output-active-color, #6b6b6b);
  color: var(--smcp-key);
  opacity: 1;
}
.smcp-unified .smcp-bar[data-kind="answer"] {
  --smcp-key: var(--smcp-answer-color, #15803d);
  --smcp-key-active: var(--smcp-answer-active-color, #166534);
  color: var(--smcp-key);
  opacity: 1;
}
.smcp-unified .smcp-bar[data-kind="question"] {
  --smcp-key: var(--smcp-question-color, #b45309);
  --smcp-key-active: var(--smcp-question-active-color, #92400e);
  color: var(--smcp-key);
  opacity: 1;
}
body[data-ds-dark-theme] .smcp-unified .smcp-bar[data-role="user"] {
  --smcp-key: var(--smcp-user-color, #60a5fa);
  --smcp-key-active: var(--smcp-user-active-color, #93c5fd);
}
body[data-ds-dark-theme] .smcp-unified .smcp-bar[data-role="assistant"] {
  --smcp-key: var(--smcp-assistant-color, #a78bfa);
  --smcp-key-active: var(--smcp-assistant-active-color, #c4b5fd);
}
body[data-ds-dark-theme] .smcp-unified .smcp-bar[data-kind="output"] {
  --smcp-key: var(--smcp-output-color, #e5e5e5);
  --smcp-key-active: var(--smcp-output-active-color, #ffffff);
}
body[data-ds-dark-theme] .smcp-unified .smcp-bar[data-kind="answer"] {
  --smcp-key: var(--smcp-answer-color, #4ade80);
  --smcp-key-active: var(--smcp-answer-active-color, #86efac);
}
body[data-ds-dark-theme] .smcp-unified .smcp-bar[data-kind="question"] {
  --smcp-key: var(--smcp-question-color, #fbbf24);
  --smcp-key-active: var(--smcp-question-active-color, #fde68a);
}
body[data-ds-dark-theme] .smcp-tooltip,
body[data-ds-dark-theme] .smcp-tooltip-title,
body[data-ds-dark-theme] .smcp-key-label {
  color: var(--dsw-alias-label-primary, #f1f1f3);
}
body[data-ds-dark-theme] .smcp-tooltip-body,
body[data-ds-dark-theme] .smcp-navigation-status {
  color: var(--dsw-alias-label-secondary, #b7bac3);
}
.smcp-unified .smcp-bar[data-kind="final"] {
  box-shadow: 0 3px 0 -1px currentColor;
}
.smcp-unified .smcp-bar[data-kind="question"],
.smcp-unified .smcp-bar[data-kind="answer"] { border-radius: 0; }
.smcp-key-label { display:block;font-size:11px;line-height:18px;font-weight:600; }
@media (forced-colors: active) {
  .smcp-unified .smcp-bar { background: ButtonText; border: 1px solid ButtonText; }
  .smcp-unified .smcp-bar[aria-current="true"] { outline: 2px solid Highlight; }
}
`
const dictionaries = {
  en: { input: 'User · Input', output: 'AI · Output', final: 'AI · Final result', question: 'AI · Question', answer: 'User · Answer', turn: 'History turn', pending: 'Awaiting your answer', answered: 'Answered', unanswered: 'No valid answer recorded', error: 'Question cancelled or failed', missing: 'The target could not be revealed. Retry or open the native transcript.' },
  zh: { input: '用户 · 输入', output: 'AI · 输出', final: 'AI · 最终结果', question: 'AI · 提问', answer: '用户 · 回答', turn: '历史轮次', pending: '等待你回答', answered: '已回答', unanswered: '未记录有效回答', error: '提问已取消或失败', missing: '目标暂时无法展开，请重试或查看原生正文。' },
  'zh-TW': { input: '使用者 · 輸入', output: 'AI · 輸出', final: 'AI · 最終結果', question: 'AI · 提問', answer: '使用者 · 回答', turn: '歷史輪次', pending: '等待你回答', answered: '已回答', unanswered: '未記錄有效回答', error: '提問已取消或失敗', missing: '目標暫時無法展開，請重試或查看原生正文。' },
} as const
export function semanticLabel(item: PianoItem, language: PianoLanguage): string {
  const copy = dictionaries[language]
  const kind = item.kind ?? (item.role === 'turn' ? 'turn' : item.role === 'user' ? 'input' : 'output')
  return copy[kind] + (item.interactionState === undefined ? '' : ` · ${copy[item.interactionState]}`)
}
export function landingFailure(language: PianoLanguage): string { return dictionaries[language].missing }
