/**
 * Validated categorical palette (light surface, scripts/validate_palette: all checks pass).
 * One fixed colour per score series; kept out of client modules so server components can import it.
 */
export const SCORE_SERIES_COLORS = {
  overall: "#2a78d6",
  technical: "#11a094",
  onpage: "#4a3aa7",
  performance: "#d55181",
  local: "#7f8c1f",
  conversion: "#8a5cd6",
} as const;
