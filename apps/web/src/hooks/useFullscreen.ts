import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
};
const isFullscreen = () => document.fullscreenElement !== null;

// Whether the page is in fullscreen, and a toggle. Some browsers (iPhone Safari) have no
// fullscreen for pages: `supported` is false there and the button is disabled.
export function useFullscreen(): { fullscreen: boolean; supported: boolean; toggle: () => void } {
  const fullscreen = useSyncExternalStore(subscribe, isFullscreen, () => false);
  const supported = typeof document !== 'undefined' && document.fullscreenEnabled === true;
  const toggle = () => {
    const done = fullscreen ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    done.catch(() => {}); // refused by the browser (no user gesture, a policy): stay as we are
  };
  return { fullscreen, supported, toggle };
}
