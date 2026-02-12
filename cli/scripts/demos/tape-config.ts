/**
 * Shared VHS tape configuration
 *
 * Warp-like aesthetic using VHS's custom JSON theme with Supabase brand colors.
 * All tapes Source a shared config.tape generated from these values.
 */

export const TAPE_CONFIG = {
  shell: "bash",
  width: 1200,
  height: 600,
  fontFamily: "Menlo",
  fontSize: 16,
  lineHeight: 1.2,
  padding: 24,
  borderRadius: 8,
  windowBar: "Colorful",
  cursorBlink: false,
  typingSpeed: "40ms",
  framerate: 30,
  loopOffset: "0%",

  // Custom dark theme approximating Warp with Supabase brand colors
  theme: {
    name: "Supabase Dark",
    black: "#0c0c0c",
    red: "#ff6b6b",
    green: "#3ecf8e", // Supabase brand green
    yellow: "#f0c040",
    blue: "#6c63ff",
    magenta: "#a78bfa",
    cyan: "#22d3ee",
    white: "#e0e0e0",
    brightBlack: "#555580",
    brightRed: "#ff8787",
    brightGreen: "#69f0ae",
    brightYellow: "#ffe066",
    brightBlue: "#8b83ff",
    brightMagenta: "#c4b5fd",
    brightCyan: "#67e8f9",
    brightWhite: "#ffffff",
    background: "#0c0c0c",
    foreground: "#e0e0e0",
    cursor: "#3ecf8e",
    selection: "#3ecf8e33",
  },

  helpPause: "3s",
  examplePause: "2s",
  sectionGap: "1s",
} as const;

/**
 * Generate the shared config.tape content from TAPE_CONFIG
 */
export function generateConfigTape(): string {
  const c = TAPE_CONFIG;
  const lines: string[] = [
    "# Auto-generated VHS config — do not edit",
    `Set Shell "${c.shell}"`,
    `Set FontFamily "${c.fontFamily}"`,
    `Set FontSize ${c.fontSize}`,
    `Set LineHeight ${c.lineHeight}`,
    `Set Padding ${c.padding}`,
    `Set BorderRadius ${c.borderRadius}`,
    `Set WindowBar "${c.windowBar}"`,
    `Set CursorBlink ${c.cursorBlink}`,
    `Set TypingSpeed ${c.typingSpeed}`,
    `Set Framerate ${c.framerate}`,
    `Set LoopOffset ${c.loopOffset}`,
    `Set Width ${c.width}`,
    `Set Height ${c.height}`,
    `Set Theme ${JSON.stringify(c.theme)}`,
  ];
  return lines.join("\n") + "\n";
}
