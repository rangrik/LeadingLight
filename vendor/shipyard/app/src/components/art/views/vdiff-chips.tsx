import { useMemo } from "react";

import { VdiffChips } from "@/components/art/views/vdiff-view";
import type { Art } from "@/lib/art/model";
import { parseVdiff } from "@/lib/art/vdiff";

// A visual diff's card and tile chips: what needs a look, at most three
// with "+n more", then how many pages are unchanged.
export default function VdiffCardChips({ body }: { art: Art; body: string }) {
  const v = useMemo(() => parseVdiff(body), [body]);
  return v ? <VdiffChips v={v} max={3} /> : null;
}
