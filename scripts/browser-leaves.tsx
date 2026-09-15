/** Only presentation leaves are stubbed. ChatView and TurnNavigator stay original. */
import React from 'react'
export function ChatNodeSeat({ nodeKey, useChatNode }: any) {
  const node = useChatNode(nodeKey, (value: any) => value)
  if (!node) return null
  const text = node.kind === 'user' ? node.data.content[0].text : node.data.blocks[0].text
  return <article data-chat-anchor-key={node.key} data-chat-turn={node.location.turn}
    data-chat-flow-key={node.key} hidden={node.visibility === 'hidden'}
    style={{ boxSizing: 'border-box', minHeight: node.kind === 'user' ? 90 : 200, padding: 24,
      border: '1px solid #ddd', borderRadius: 10, background: node.kind === 'user' ? '#f6f7fa' : '#fff' }}>
    <b>{node.kind === 'user' ? 'User' : 'Assistant'} · Turn {node.location.turn}</b><p>{text}</p>
  </article>
}
export const PendingSteeringBubble = () => null
export const PendingSubmissionBubble = () => null
export const IconChevronDownOutline14 = () => <span>↓</span>
export const Modal = () => null
export const Button = (props: any) => <button {...props} />
export const formatRunDuration = () => ''
