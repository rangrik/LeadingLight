import { REMOTE_FEATURES_ENABLED, SEPARATE_WINDOWS_ENABLED } from './localPolicy'

const REMOTE_COMMANDS = new Set([
  'add-remote',
  'check-updates',
  'commit-push',
  'generate-commit-message',
  'git-pull',
  'install-mcp',
  'new-ai-chat',
  'open-ai-agents',
  'open-contribute',
  'restore-getting-started',
  'restore-vault-ai-guidance',
  'switch-default-ai-agent',
  'toggle-ai-panel',
])

export function isLocalCommandVisible(command: { id: string }): boolean {
  if (!SEPARATE_WINDOWS_ENABLED && command.id === 'open-in-new-window') return false
  if (REMOTE_FEATURES_ENABLED) return true
  return !REMOTE_COMMANDS.has(command.id)
    && !command.id.startsWith('switch-ai-agent-')
    && !command.id.startsWith('switch-default-ai-agent-')
    && !command.id.startsWith('git-pull-')
}
