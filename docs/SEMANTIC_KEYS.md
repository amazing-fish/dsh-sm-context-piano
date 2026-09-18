# Final-result, interactive-question and speaker-coloured Piano keys

## Scope

Continue the single visible Piano and full-history navigation from PR #2. Add one independent AI final-result key per durably closed successful Turn, native ask_user_question exchanges as keys, and user/AI colour differentiation. No second rail, new pager, responder, model call or transcript persistence.

## Final result

Use the published `turn-tail.data.closing` (`FinalAssistantChatData`) and match its step and durable assistant message identity/sequence to the actual Chat node. `finalNode` on an arbitrary completed model step is not evidence of a completed Turn. Never classify the last DOM row, an interrupted prefix, error/max-token Turn or a page missing the real closing message as final.

The final message gets exactly one independent key, retaining its first output key during streaming-to-settled promotion. It cannot merge into process prose. Reasoning and tool payloads do not enter its preview. The target is the actual final message row, not the earlier process row or Turn footer. A multi-paragraph final response is one result key, not a key per paragraph.

## Interactive questions

Only the exact `ask_user_question` tool is projected. Read its running call head or settled result's `call` and `content`, including recursive subcalls. Pair question and answer by `(callId, questionId)`, not array position. A pending request has an AI-question key. A valid recorded answer adds a user-answer key; selected options and free text preserve the tool's single/multi-select semantics. Error, cancelled, malformed and ambiguous results never become accepted answers.

Keys jump to native `call:<callId>` anchors. A compacted process row is revealed using the original `beforematch` reveal callback, then only the native question disclosure header is expanded. No answer/approval/submission button is invoked. Every question in one tool call can have its own preview; its question/answer keys land on the same native question-card container. The plugin does not offer a second answer form.

The short local disclosure transaction is cancelled on new navigation, reader input, fallback, session switch and disposal. It does not call `loadThrough`; original ChatView remains the only history-navigation owner.

## Roles and accessibility

User input and recorded answers use blue; AI output, questions and final results use purple. Active and hover keep their speaker family in both light and dark themes. Final keys have a second stroke; question/answer keys have square ends. Hover and accessible names include explicit role/kind/state labels in zh/en/zh-TW, so role is not conveyed only by colour. Unknown/unloaded Turn placeholders stay neutral rather than pretending to know internal roles.

Custom CSS variables: `--smcp-user-color`, `--smcp-user-active-color`, `--smcp-assistant-color`, `--smcp-assistant-active-color`.

## Existing compatibility bug corrected

DSH 0.1.5-rc.2 stores a `TurnLocation` object at `location.turn`; the number is `location.turn.turn`. The prior adapter expected a number, causing user messages without `data.turn` to lose their Turn and be dropped by the full-history merge. Fixtures now include the real nested shape.

## Historical colour evidence

This repository's initial commit `c344b300e7927d1abca3f149d0081bdc5cdd4fe1` (2026-08-17) already used one gray palette for all bars, with a shared active/hover colour; the subsequent `11a76f6` style retained it. PR #1/#2 did not remove a role selector from that stylesheet. This does not establish what may have existed in a local/unpublished variant. This PR implements the explicit role-colour requirement regardless.

## History and validation boundary

Unloaded history still has genuine Turn placeholders; once native history loading materializes its nodes, final and question/answer keys are derived from the full records. An outline alone cannot identify internal question ids or final message anchors, so this PR does not invent them.

Run `pnpm install --frozen-lockfile` and `pnpm verify` in Node 24 / PowerShell. CI also runs fixed-official-source Chromium component tests. These are not user-machine authentication, backend or proxy end-to-end tests. No npm release or auto-merge is performed.

## Pinned sources

- DSH `c291e7961a515f6d7af9304e7fd1d257929aef26`: ui-chat contract/chat-nodes.ts, chat/ChatNodeSeat.tsx, chat/searchable-hidden.ts.
- Same DSH commit: ui-conversation contract/records.ts, ui-tool/tool/ToolCallTree.tsx, ui-primitives/DisclosureRow.tsx.
