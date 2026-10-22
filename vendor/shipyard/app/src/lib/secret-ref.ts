import { isSecretRef } from "@/lib/api";

// Secret references in an environment value, checked the way the box checks
// them (internal/box/secrets.go), so a mistake shows while it is typed and
// not as the box's error on save.

// 1Password's own syntax: op://vault/item/[section/]field, with an optional
// query such as ?attribute=otp.
const OP_REF = /^op:\/\/[^/?\x00-\x1f]+(\/[^/?\x00-\x1f]+){2,3}(\?[A-Za-z0-9_=&.-]+)?$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// refProblem says what is wrong with a value that is, or looks meant to be,
// a secret reference. A plain value is fine and gets undefined.
export function refProblem(value: string): string | undefined {
  const v = value;
  if (isSecretRef(v)) {
    if (v.startsWith("op://")) {
      if (OP_REF.test(v)) return undefined;
      const parts = v.slice("op://".length).split("?")[0].split("/");
      if (parts.some((p) => !p)) return "A 1Password reference has no empty parts: op://vault/item/field.";
      if (parts.length < 3) return "A 1Password reference names a vault, an item and a field: op://vault/item/field.";
      if (parts.length > 4) return "Too many parts. A 1Password reference is op://vault/item/field, or op://vault/item/section/field.";
      return "Not a 1Password reference. Write it as op://vault/item/field.";
    }
    const name = v.slice("env://".length);
    return ENV_NAME.test(name) ? undefined : "env:// takes a variable name from the box's environment, like env://STRIPE_KEY: letters, digits and _.";
  }
  const trimmed = v.trim();
  if (trimmed !== v && isSecretRef(trimmed)) return "Remove the spaces around it, or the box uses it as plain text.";
  // Almost a reference: the box would use it as plain text, silently.
  if (/^(op|env)(:\/?(?!\/)|\/\/|:\/\/\/)/i.test(trimmed) || /^(OP|ENV|Op|Env):\/\//.test(trimmed)) {
    return /^op/i.test(trimmed)
      ? "Looks like a 1Password reference, but the box would use it as plain text. Write it as op://vault/item/field."
      : "Looks like a variable reference, but the box would use it as plain text. Write it as env://NAME.";
  }
  return undefined;
}

// explainSecretError turns what the box says about a reference into a
// sentence for the person. Values never appear in these: the box keeps
// them out of every error.
export function explainSecretError(msg: string): string {
  const m = msg.trim();
  if (/is not a 1Password reference/.test(m)) return "Not a 1Password reference. Write it as op://vault/item/field.";
  if (/is not a variable reference/.test(m)) return "Not a variable reference. Write it as env://NAME.";
  if (/not a secret reference/.test(m)) return "Not a secret reference. Use op://vault/item/field or env://NAME.";
  let x = m.match(/^(\S+) is not set in berthd's environment/);
  if (x) return `${x[1]} isn't set in berthd's environment on this box.`;
  if (/1Password CLI \(op\) is not installed/.test(m)) return "The 1Password CLI (op) isn't installed on this box.";
  x = m.match(/^op read timed out after (\S+)/);
  if (x) return `1Password didn't answer within ${x[1]}.`;
  if (/^op read failed/.test(m)) return "1Password couldn't read it. Check that op is signed in on this box.";
  x = m.match(/^op: (?:\[ERROR\] \S+ \S+ )?([\s\S]+)$/);
  if (x) return `1Password: ${x[1].charAt(0).toUpperCase()}${x[1].slice(1)}`;
  x = m.match(/^no provider for (\S+):\/\/ references/);
  if (x) return `This box can't read ${x[1]}:// references.`;
  return m;
}

// explainConfigError rewrites the box's refusal of a config whose secret
// reference is malformed ('STRIPE_KEY: "op:/x" is not a 1Password
// reference; …') to name the variable and say how to write it.
export function explainConfigError(msg: string): string {
  const x = msg.match(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*): "((?:[^"\\]|\\.)*)" is not a (1Password|variable|secret) reference/);
  if (!x) return msg;
  const how = x[3] === "1Password" ? "op://vault/item/field" : x[3] === "variable" ? "env://NAME" : "op://vault/item/field or env://NAME";
  return `${x[1]} isn't a valid secret reference. Write it as ${how}, or fix it in Environment.`;
}
