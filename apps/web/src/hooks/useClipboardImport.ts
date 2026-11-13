import { useEffect, type RefObject } from 'react';

type Options = {
  active?: boolean;
  /** Imports files the same way as a drop; with no position they land at the viewport centre. */
  onFiles: (files: FileList) => void;
};

const editable = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';
const isMedia = (file: File) => /^(image|video)\//.test(file.type);

/** ⌘V / Ctrl+V with an image or video on the clipboard adds it to the canvas. */
export function useClipboardImport(options: RefObject<Options>) {
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const { active, onFiles } = options.current;
      if (active === false || document.querySelector('dialog[open]')) return;
      if ((event.target as Element | null)?.closest?.(editable)) return;
      const files = event.clipboardData?.files;
      if (!files || ![...files].some(isMedia)) return;
      event.preventDefault();
      onFiles(files);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [options]);
}
