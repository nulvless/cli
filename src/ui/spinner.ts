const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_MS = 80;
export const CLEAR_LINE = '\r\x1b[2K';
const HIDE_CURSOR = '\x1b[?25l';
export const SHOW_CURSOR = '\x1b[?25h';

export interface Spinner {
  stop(): void;
}

export function startSpinner(stream: { write(text: string): unknown }, label: string, paint: (frame: string) => string): Spinner {
  let index = 0;
  const showCursor = () => stream.write(SHOW_CURSOR);
  const draw = () => stream.write(`${CLEAR_LINE}${paint(FRAMES[index++ % FRAMES.length] ?? '')} ${label}`);

  stream.write(HIDE_CURSOR);
  process.once('exit', showCursor);
  draw();
  const timer = setInterval(draw, FRAME_MS);

  return {
    stop() {
      clearInterval(timer);
      process.off('exit', showCursor);
      stream.write(`${CLEAR_LINE}${SHOW_CURSOR}`);
    },
  };
}
