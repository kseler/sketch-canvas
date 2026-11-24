// The shared drawing space. Every player and the exported image use these coordinates; the stage
// is only scaled to fit each screen, so a stroke lands in the same place for everyone.
// The only place canvas dimensions are written down (see CLAUDE.md).
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;
