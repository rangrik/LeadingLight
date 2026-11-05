import { syntaxColors as upstreamSyntaxColors, type ShikiTheme } from "../../../../vendor/shipyard/app/src/lib/syntax-colors.ts";

export * from "../../../../vendor/shipyard/app/src/lib/syntax-colors.ts";

export function syntaxColors(theme: ShikiTheme) {
  const resolved = theme as ShikiTheme & { textmate?: ShikiTheme };
  return upstreamSyntaxColors(resolved.textmate ?? theme);
}
