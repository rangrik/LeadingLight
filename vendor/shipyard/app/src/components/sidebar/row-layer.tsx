import type { ComponentProps } from "react";

import { RowMenus } from "@/components/sidebar/actions";
import { useTipLayer } from "@/components/tip";

// RowLayer holds a long list of rows, the sidebar's projects and worktrees
// or the rail's agents: one context menu (RowMenus) and one tooltip (a tip
// layer) for all of them, so a row costs its own few elements and nothing
// more until it is pointed at, focused or right-clicked. It renders a div,
// with the props given.
export function RowLayer({ children, onPointerOver, onPointerOut, onFocus, onBlur, onPointerDown, onKeyDown, ...props }: ComponentProps<"div">) {
  const tips = useTipLayer();
  return tips.provider(
    <RowMenus
      {...props}
      onPointerOver={(e) => {
        onPointerOver?.(e);
        tips.props.onPointerOver(e);
      }}
      onPointerOut={(e) => {
        onPointerOut?.(e);
        tips.props.onPointerOut(e);
      }}
      onFocus={(e) => {
        onFocus?.(e);
        tips.props.onFocus(e);
      }}
      onBlur={(e) => {
        onBlur?.(e);
        tips.props.onBlur(e);
      }}
      onPointerDown={(e) => {
        onPointerDown?.(e);
        tips.props.onPointerDown(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        tips.props.onKeyDown(e);
      }}
    >
      {children}
      {tips.tooltip}
    </RowMenus>,
  );
}
