export const LEADINGLIGHT_NAME = 'LeadingLight'

/** Apply fork branding to rendered interface copy; keep stored identifiers intact. */
export function brandCopy(text: string): string {
  return text.replaceAll('Tolaria', LEADINGLIGHT_NAME)
}
