const REPO = 'Nyrokume/vless-hub'
const WORKFLOW = 'update.yml'
export const ACTIONS_PAGE = 'https://github.com/Nyrokume/vless-hub/actions/workflows/update.yml'
const TOKEN_KEY = 'vless-hub-actions-token'

export function readActionsToken(): string {
  try {
    return (localStorage.getItem(TOKEN_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function writeActionsToken(value: string): void {
  const trimmed = value.trim()
  try {
    if (!trimmed) localStorage.removeItem(TOKEN_KEY)
    else localStorage.setItem(TOKEN_KEY, trimmed)
  } catch {
    // Storage can be blocked. The field still shows what was typed.
  }
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

export async function dispatchServerCheck(token: string): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    },
  )
  if (response.status === 401) throw new Error('unauthorized')
  if (response.status === 403 || response.status === 404) throw new Error('forbidden')
  if (!response.ok) throw new Error('github')
}

export type ServerRun = {
  id: number
  status: string
  conclusion: string | null
}

export async function findDispatchSince(token: string, sinceMs: number): Promise<ServerRun | null> {
  const response = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/runs?per_page=8`,
    { headers: githubHeaders(token) },
  )
  if (!response.ok) return null
  const payload = (await response.json()) as {
    workflow_runs?: { id: number; event?: string; status?: string; conclusion?: string | null; created_at?: string }[]
  }
  for (const run of payload.workflow_runs ?? []) {
    if (run.event !== 'workflow_dispatch') continue
    const created = Date.parse(run.created_at || '')
    if (Number.isNaN(created) || created + 5000 < sinceMs) continue
    return { id: run.id, status: run.status || '', conclusion: run.conclusion ?? null }
  }
  return null
}

export function openActionsPage(): void {
  window.open(ACTIONS_PAGE, '_blank', 'noopener')
}
