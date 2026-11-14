import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { Card, ProjectState, UpdateProject } from '../../types';
import { isDesktop } from '../../platform';
import { DesktopMediaTooLargeError, putMedia } from '../project/media-store';
import { uid } from '../project/project';
import { CARD_CENTER } from './canvas-camera';

/**
 * Turns uploaded, pasted or dropped image and video files into cards on the canvas.
 * `pendingImports` holds the imports still saving their media, so closing can wait for them.
 */
export function useFileImport({
  projectRef,
  viewportRef,
  update,
  toast,
}: {
  projectRef: RefObject<ProjectState>;
  viewportRef: RefObject<HTMLElement | null>;
  update: UpdateProject;
  toast: (message: string) => void;
}) {
  // Object URLs for imported files, revoked on unmount.
  const uploadedURLs = useRef(new Set<string>());
  const mounted = useRef(true);
  const pendingImports = useRef(new Set<Promise<void>>());
  useEffect(() => {
    mounted.current = true;
    const urls = uploadedURLs.current;
    return () => {
      mounted.current = false;
      urls.forEach(url => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);
  const readFiles = useCallback(
    async (files: FileList, point?: { x: number; y: number }) => {
      const valid = [...files].filter(file => /^(image|video)\//.test(file.type));
      if (!valid.length) {
        toast('请选择图片或视频文件');
        return;
      }
      const cards: Card[] = [];
      const camera = projectRef.current.camera;
      const rect = viewportRef.current?.getBoundingClientRect();
      const origin = point ?? {
        x: ((rect?.width ?? 1000) / 2 - camera.x) / camera.zoom - CARD_CENTER.x,
        y: ((rect?.height ?? 600) / 2 - camera.y) / camera.zoom - CARD_CENTER.y,
      };
      // Repeated pastes or uploads without a drop point must not hide earlier cards underneath.
      if (!point)
        while (
          projectRef.current.cards.some(
            card => Math.abs(card.x - origin.x) < 8 && Math.abs(card.y - origin.y) < 8,
          )
        ) {
          origin.x += 35;
          origin.y += 35;
        }
      for (const [index, file] of valid.entries()) {
        const src = URL.createObjectURL(file);
        uploadedURLs.current.add(src);
        const card: Card = {
          id: uid(),
          x: origin.x + index * 35,
          y: origin.y + index * 35,
          name: file.name.replace(/\.[^.]+$/, ''),
          kind: file.type.startsWith('video/') ? 'video' : 'image',
          src,
          tone: 'normal',
          label: '本地素材',
          mimeType: file.type,
        };
        try {
          card.mediaId = await putMedia(file);
        } catch (error) {
          card.sessionOnly = true;
          if (error instanceof DesktopMediaTooLargeError)
            toast(`${error.message}，请压缩后重新导入`);
          else
            toast(
              isDesktop()
                ? '素材未能保存到本机，请保留原文件'
                : '浏览器未能保存此文件，刷新前请保留原文件',
            );
        }
        cards.push(card);
      }
      if (!mounted.current) {
        cards.forEach(card => {
          URL.revokeObjectURL(card.src);
          uploadedURLs.current.delete(card.src);
        });
        return;
      }
      update(draft => {
        draft.cards.push(...cards);
        draft.selected = cards.at(-1)!.id;
      });
    },
    [projectRef, viewportRef, update, toast],
  );
  const importFiles = useCallback(
    (files: FileList, point?: { x: number; y: number }) => {
      const operation = readFiles(files, point);
      pendingImports.current.add(operation);
      const clear = () => {
        pendingImports.current.delete(operation);
      };
      void operation.then(clear, clear);
      return operation;
    },
    [readFiles],
  );
  return { importFiles, pendingImports };
}
