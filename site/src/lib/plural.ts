const rules = new Intl.PluralRules('ru')

/** Thousands grouped with a narrow no-break space, so "4 808" stays one token. */
export function formatCount(count: number): string {
  const whole = Math.trunc(Math.abs(Number.isFinite(count) ? count : 0))
  const sign = count < 0 ? '−' : ''
  return sign + String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')
}

export type PluralForms = readonly [one: string, few: string, many: string]

export function pluralCategory(count: number): Intl.LDMLPluralRule {
  const whole = Math.trunc(Math.abs(Number.isFinite(count) ? count : 0))
  return rules.select(whole)
}

export function pluralForm(count: number, forms: PluralForms): string {
  const category = pluralCategory(count)
  if (category === 'one') return forms[0]
  if (category === 'few') return forms[1]
  return forms[2]
}

export function plural(count: number, forms: PluralForms): string {
  return `${formatCount(count)} ${pluralForm(count, forms)}`
}
