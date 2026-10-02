export const ACTIONS_PAGE = 'https://github.com/Nyrokume/vless-hub/actions/workflows/update.yml'

const STORED_TOKEN_KEY = 'vless-hub-actions-token'

/** Drop a token saved by older builds. The site no longer reads or stores it. */
export function forgetStoredActionsToken(): void {
  try {
    localStorage.removeItem(STORED_TOKEN_KEY)
  } catch {
    // Storage can be blocked. Nothing else reads the key.
  }
}

forgetStoredActionsToken()

export function openActionsPage(): void {
  window.open(ACTIONS_PAGE, '_blank', 'noopener')
}
