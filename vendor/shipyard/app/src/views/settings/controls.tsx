import { PickOne } from "@/components/pick-one";
import { NumberField, NumberFieldDecrement, NumberFieldGroup, NumberFieldIncrement, NumberFieldInput } from "@/components/ui/number-field";
import { useSettingsRow } from "@/views/settings/rows";

// Segmented picks one of a few values, with the app's shared PickOne.
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label?: string }) {
  const row = useSettingsRow();
  return <PickOne value={value} options={options} onChange={onChange} label={label} aria-labelledby={label ? undefined : row?.labelledBy} aria-describedby={row?.describedBy} />;
}

// Stepper is a small number field with − and + on either side.
export function Stepper({ value, onChange, min, max, step = 1, format }: { value: number; onChange(v: number): void; min: number; max: number; step?: number; format?: Intl.NumberFormatOptions }) {
  const row = useSettingsRow();
  return (
    <NumberField size="sm" className="w-36" value={value} min={min} max={max} step={step} format={format} onValueChange={(v) => v != null && onChange(v)}>
      <NumberFieldGroup aria-labelledby={row?.labelledBy}>
        <NumberFieldDecrement />
        <NumberFieldInput className="text-center tabular-nums" aria-labelledby={row?.labelledBy} aria-describedby={row?.describedBy} />
        <NumberFieldIncrement />
      </NumberFieldGroup>
    </NumberField>
  );
}
