import React from "react";
import { Transform } from "ink";

/**
 * Outputs a space and resets ANSI styles to prevent bleeding between Text elements.
 *
 * Omit the trailing space from preceding text - this component provides it.
 *
 * Background: In terminals, `dim` and `bold` share the same reset code (\x1b[22m).
 * Ink doesn't reset styles between siblings, so they bleed. This outputs \x1b[0m.
 *
 * @example
 * <Box>
 *   <Text dimColor>Label -</Text>
 *   <StyleReset />
 *   <Text bold>Value</Text>
 * </Box>
 * // Renders: "Label - Value" (dim label, bold value, space from StyleReset)
 */
export function StyleReset() {
  return <Transform transform={() => "\x1b[0m"}>{" "}</Transform>;
}
