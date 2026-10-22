import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface Option {
  value: string;
  label: string;
}

// SimpleSelect is a Select over plain string values.
export function SimpleSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  size,
  className,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: {
  options: Option[];
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  disabled?: boolean;
  size?: "sm" | "default" | "lg";
  className?: string;
  // A select with no visible label names itself (JSX lets an aria-* prop
  // through untyped, so it is listed here to be passed on).
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  return (
    <Select items={options} value={selected} onValueChange={(o: Option | null) => onChange(o?.value ?? "")} disabled={disabled}>
      <SelectTrigger size={size} className={className} aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectPopup>
        {options.map((o) => (
          <SelectItem key={o.value} value={o}>
            {o.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
