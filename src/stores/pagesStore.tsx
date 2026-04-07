import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { db, generateId } from '../db/index';
import { ocrEvents } from '../events/ocrEvents';
import { dbLogger } from '../utils/logger';
import createThumbnail from '../utils/createThumbnail';
import { createPagePersistenceBuffer } from '../services/pagePersistence';
import type { OcrEventMap } from '../types/events';
import type { Page, PageStatus, StoredPage } from '../types/page';

/**
 * Page-centric state model (borrowed from DeepSeek-OCR-WebUI's usePagesStore)
 *
 * Replaces the old parallel arrays (images[], results[], statuses[]) with a unified
 * pages[] where each page is an independent unit with its own status, result, and logs.
 *
 * Status machine:
 *   idle -> queued -> processing -> done | error
 */

export const PAGE_STATUS = {
  IDLE: 'idle',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
} as const satisfies Record<'IDLE' | 'QUEUED' | 'PROCESSING' | 'DONE' | 'ERROR', PageStatus>;

function isPreviewableFileType(fileType: string): boolean {
  return fileType.startsWith('image/');
}

interface PagesState {
  pages: Page[];
  selectedPageId: string | null;
  pageIndexById: Record<string, number>;
  processingCount: number;
  completedCount: number;
  initialized: boolean;
}

function getStatusCounts(pages: Page[]): Pick<PagesState, 'processingCount' | 'completedCount'> {
  let processingCount = 0;
  let completedCount = 0;

  for (const page of pages) {
    if (page.status === PAGE_STATUS.PROCESSING || page.status === PAGE_STATUS.QUEUED) {
      processingCount++;
    } else if (page.status === PAGE_STATUS.DONE) {
      completedCount++;
    }
  }

  return { processingCount, completedCount };
}

const THUMBNAIL_BACKFILL_BATCH_SIZE = 4;
const MAX_CACHED_IMAGE_URLS = 12;

type PagesAction =
  | { type: 'SET_PAGES'; pages: Page[] }
  | { type: 'ADD_PAGE'; page: Page }
  | { type: 'UPDATE_PAGE'; id: string; updates: Partial<Page> }
  | { type: 'DELETE_PAGES'; ids: string[] }
  | { type: 'CLEAR_ALL' }
  | { type: 'SELECT_PAGE'; id: string | null }
  | { type: 'SET_CURRENT_INDEX'; index: number };

interface PagesContextValue {
  state: PagesState;
  objectUrlsRef: MutableRefObject<Map<string, string>>;
}

export interface UsePagesResult {
  pages: Page[];
  currentPage: Page | null;
  currentIndex: number;
  selectedPageId: string | null;
  initialized: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  totalPages: number;
  processingCount: number;
  completedCount: number;
  addPage: (file: File) => Promise<Page>;
  addPages: (files: File[]) => Promise<Page[]>;
  deletePage: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
  selectPage: (id: string | null) => void;
  goTo: (index: number) => void;
  loadFromDB: () => Promise<void>;
  loadImageUrl: (pageId: string) => Promise<string | null>;
  syncVisibleImages: (pageIds: string[]) => Promise<void>;
  prevPage: () => void;
  nextPage: () => void;
}

function pagesReducer(state: PagesState, action: PagesAction): PagesState {
  switch (action.type) {
    case 'SET_PAGES':
      return {
        ...state,
        pages: action.pages,
        pageIndexById: Object.fromEntries(action.pages.map((page, index) => [page.id, index])),
        ...getStatusCounts(action.pages),
        selectedPageId: action.pages.some((page) => page.id === state.selectedPageId)
          ? state.selectedPageId
          : (action.pages[0]?.id ?? null),
        initialized: true,
      };

    case 'ADD_PAGE': {
      const nextIndex = state.pages.length;
      const nextPages = [...state.pages, action.page];
      return {
        ...state,
        pages: nextPages,
        pageIndexById: {
          ...state.pageIndexById,
          [action.page.id]: nextIndex,
        },
        ...getStatusCounts(nextPages),
      };
    }

    case 'UPDATE_PAGE': {
      const pageIndex = state.pageIndexById[action.id];
      if (pageIndex === undefined) return state;

      const currentPage = state.pages[pageIndex];
      const hasRealChange = Object.entries(action.updates).some(([key, value]) => currentPage[key as keyof Page] !== value);
      if (!hasRealChange) return state;

      const nextPages = state.pages.slice();
      nextPages[pageIndex] = {
        ...currentPage,
        ...action.updates,
        updatedAt: new Date(),
      };

      return {
        ...state,
        pages: nextPages,
        ...getStatusCounts(nextPages),
      };
    }

    case 'DELETE_PAGES': {
      const ids = new Set(action.ids);
      const pages = state.pages.filter((page) => !ids.has(page.id));
      const selectedId = ids.has(state.selectedPageId ?? '') ? (pages[0]?.id ?? null) : state.selectedPageId;
      return {
        ...state,
        pages,
        pageIndexById: Object.fromEntries(pages.map((page, index) => [page.id, index])),
        ...getStatusCounts(pages),
        selectedPageId: selectedId,
      };
    }

    case 'CLEAR_ALL':
      return { ...state, pages: [], pageIndexById: {}, processingCount: 0, completedCount: 0, selectedPageId: null };

    case 'SELECT_PAGE':
      return { ...state, selectedPageId: action.id };

    case 'SET_CURRENT_INDEX': {
      const page = state.pages[action.index];
      return { ...state, selectedPageId: page?.id ?? null };
    }

    default:
      return state;
  }
}

const initialState: PagesState = {
  pages: [],
  selectedPageId: null,
  pageIndexById: {},
  processingCount: 0,
  completedCount: 0,
  initialized: false,
};

const PagesContext = createContext<PagesContextValue | null>(null);
const PagesDispatchContext = createContext<Dispatch<PagesAction> | null>(null);

export function PagesProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(pagesReducer, initialState);
  const objectUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const persistenceBuffer = createPagePersistenceBuffer(
      db,
      (scope, error) => dbLogger.error(scope + ':', error),
    );

    const handleQueued = ({ imageId }: OcrEventMap['ocr:queued']) => {
      dispatch({ type: 'UPDATE_PAGE', id: imageId, updates: { status: PAGE_STATUS.QUEUED } });
      persistenceBuffer.queueImageUpdate(imageId, { status: PAGE_STATUS.QUEUED });
    };

    const handleStart = ({ imageId }: OcrEventMap['ocr:start']) => {
      dispatch({ type: 'UPDATE_PAGE', id: imageId, updates: { status: PAGE_STATUS.PROCESSING } });
      persistenceBuffer.queueImageUpdate(imageId, { status: PAGE_STATUS.PROCESSING });
    };

    const handleProgress = ({ imageId, text }: OcrEventMap['ocr:progress']) => {
      dispatch({ type: 'UPDATE_PAGE', id: imageId, updates: { ocrText: text } });
    };

    const handleSuccess = ({ imageId, text }: OcrEventMap['ocr:success']) => {
      dispatch({
        type: 'UPDATE_PAGE',
        id: imageId,
        updates: { status: PAGE_STATUS.DONE, ocrText: text },
      });
      persistenceBuffer.queueImageUpdate(imageId, { status: PAGE_STATUS.DONE, ocrText: text });
      persistenceBuffer.queueOcrSave(imageId, { text, rawText: text, status: PAGE_STATUS.DONE, createdAt: new Date() });
    };

    const handleError = ({ imageId, error }: OcrEventMap['ocr:error']) => {
      const message = error.message || String(error);
      dispatch({
        type: 'UPDATE_PAGE',
        id: imageId,
        updates: { status: PAGE_STATUS.ERROR, ocrText: `Error: ${message}` },
      });
      persistenceBuffer.queueImageUpdate(imageId, { status: PAGE_STATUS.ERROR, ocrText: `Error: ${message}` });
      persistenceBuffer.queueOcrDelete(imageId);
    };

    const handleCancelled = ({ imageId }: OcrEventMap['ocr:cancelled']) => {
      dispatch({
        type: 'UPDATE_PAGE',
        id: imageId,
        updates: { status: PAGE_STATUS.IDLE, ocrText: '' },
      });
      persistenceBuffer.queueImageUpdate(imageId, { status: PAGE_STATUS.IDLE, ocrText: '' });
      persistenceBuffer.queueOcrDelete(imageId);
    };

    ocrEvents.on('ocr:queued', handleQueued);
    ocrEvents.on('ocr:start', handleStart);
    ocrEvents.on('ocr:progress', handleProgress);
    ocrEvents.on('ocr:success', handleSuccess);
    ocrEvents.on('ocr:error', handleError);
    ocrEvents.on('ocr:cancelled', handleCancelled);

    return () => {
      ocrEvents.off('ocr:queued', handleQueued);
      ocrEvents.off('ocr:start', handleStart);
      ocrEvents.off('ocr:progress', handleProgress);
      ocrEvents.off('ocr:success', handleSuccess);
      ocrEvents.off('ocr:error', handleError);
      ocrEvents.off('ocr:cancelled', handleCancelled);
      void persistenceBuffer.dispose();
    };
  }, []);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  return (
    <PagesContext.Provider value={{ state, objectUrlsRef }}>
      <PagesDispatchContext.Provider value={dispatch}>
        {children}
      </PagesDispatchContext.Provider>
    </PagesContext.Provider>
  );
}

export function usePagesState(): PagesState {
  const ctx = useContext(PagesContext);
  if (!ctx) throw new Error('usePagesState must be used within PagesProvider');
  return ctx.state;
}

export function usePagesDispatch(): Dispatch<PagesAction> {
  const dispatch = useContext(PagesDispatchContext);
  if (!dispatch) throw new Error('usePagesDispatch must be used within PagesProvider');
  return dispatch;
}

export function usePages(): UsePagesResult {
  const pagesContext = useContext(PagesContext);
  const dispatch = useContext(PagesDispatchContext);

  if (!pagesContext || !dispatch) {
    throw new Error('usePages must be used within PagesProvider');
  }

  const { state, objectUrlsRef } = pagesContext;
  const { pages, selectedPageId, pageIndexById, processingCount, completedCount, initialized } = state;

  const currentIndex = selectedPageId ? (pageIndexById[selectedPageId] ?? -1) : -1;
  const currentPage = currentIndex >= 0 ? pages[currentIndex] : null;

  const touchCachedImage = useCallback((pageId: string): void => {
    const cached = objectUrlsRef.current.get(pageId);
    if (!cached) return;
    objectUrlsRef.current.delete(pageId);
    objectUrlsRef.current.set(pageId, cached);
  }, [objectUrlsRef]);

  const evictCachedImages = useCallback((pinnedIds: Set<string>): void => {
    while (objectUrlsRef.current.size > MAX_CACHED_IMAGE_URLS) {
      const oldest = objectUrlsRef.current.entries().next().value as [string, string] | undefined;
      if (!oldest) break;

      const [pageId, url] = oldest;
      if (pinnedIds.has(pageId)) {
        objectUrlsRef.current.delete(pageId);
        objectUrlsRef.current.set(pageId, url);
        continue;
      }

      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(pageId);
      dispatch({ type: 'UPDATE_PAGE', id: pageId, updates: { imageUrl: '' } });
    }
  }, [dispatch, objectUrlsRef]);

  const addPage = useCallback(async (file: File): Promise<Page> => {
    const id = generateId('img');
    const previewable = isPreviewableFileType(file.type);
    const objectUrl = previewable ? URL.createObjectURL(file) : '';
    if (objectUrl) {
      objectUrlsRef.current.set(id, objectUrl);
    }
    const thumbnailUrl = previewable
      ? await createThumbnail(file).catch((error) => {
          dbLogger.warn('Failed to generate thumbnail:', error);
          return '';
        })
      : '';

    const page: Page = {
      id,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      status: PAGE_STATUS.IDLE,
      ocrText: '',
      imageUrl: objectUrl,
      thumbnailUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dispatch({ type: 'ADD_PAGE', page });

    try {
      await db.saveImageWithBlob(page, file);
    } catch (error) {
      dbLogger.error('Failed to persist page:', error);
    }

    return page;
  }, [dispatch, objectUrlsRef]);

  const addPages = useCallback(async (files: File[]): Promise<Page[]> => {
    const newPages: Page[] = [];
    for (const file of files) {
      newPages.push(await addPage(file));
    }
    return newPages;
  }, [addPage]);

  const deletePage = useCallback(async (id: string): Promise<void> => {
    const url = objectUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(id);
    }
    dispatch({ type: 'DELETE_PAGES', ids: [id] });
    await db.deleteImage(id).catch((error) => dbLogger.error('DB delete failed:', error));
  }, [dispatch, objectUrlsRef]);

  const clearAll = useCallback(async (): Promise<void> => {
    for (const url of objectUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current.clear();
    dispatch({ type: 'CLEAR_ALL' });
    await db.deleteAllImages().catch((error) => dbLogger.error('DB clear failed:', error));
  }, [dispatch, objectUrlsRef]);

  const selectPage = useCallback((id: string | null): void => {
    dispatch({ type: 'SELECT_PAGE', id });
  }, [dispatch]);

  const goTo = useCallback((index: number): void => {
    dispatch({ type: 'SET_CURRENT_INDEX', index });
  }, [dispatch]);

  const loadFromDB = useCallback(async (): Promise<void> => {
    try {
      for (const url of objectUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current.clear();

      const [saved, ocrResults] = await Promise.all([
        db.getAllImages(),
        db.getAllOcrResults(),
      ]);
      const ocrById = new Map(ocrResults.map((result) => [result.imageId, result] as const));

      const loadedPages: Page[] = saved.map((image: StoredPage) => {
        const result = ocrById.get(image.id);
        return {
          ...image,
          imageUrl: '',
          status: result?.status || image.status || PAGE_STATUS.IDLE,
          ocrText: result?.text || image.ocrText || '',
        };
      });

      dispatch({ type: 'SET_PAGES', pages: loadedPages });

      const missingThumbnails = loadedPages.filter((page) => !page.thumbnailUrl);
      void (async () => {
        const previewablePages = missingThumbnails.filter((page) => isPreviewableFileType(page.fileType));

        for (let offset = 0; offset < previewablePages.length; offset += THUMBNAIL_BACKFILL_BATCH_SIZE) {
          const batch = previewablePages.slice(offset, offset + THUMBNAIL_BACKFILL_BATCH_SIZE);
          const results = await Promise.all(batch.map(async (page) => {
            try {
              const blob = await db.getImageBlob(page.id);
              if (!blob) return null;

              const thumbnailUrl = await createThumbnail(blob);
              return { id: page.id, thumbnailUrl };
            } catch (error) {
              dbLogger.warn('Failed to backfill thumbnail:', error);
              return null;
            }
          }));

          const updates = results.filter((result): result is { id: string; thumbnailUrl: string } => Boolean(result));
          if (updates.length === 0) continue;

          for (const update of updates) {
            dispatch({ type: 'UPDATE_PAGE', id: update.id, updates: { thumbnailUrl: update.thumbnailUrl } });
          }

          await db.bulkUpdateImages(updates.map((update) => ({
            id: update.id,
            updates: { thumbnailUrl: update.thumbnailUrl },
          })));
        }
      })();
    } catch (error) {
      dbLogger.error('Failed to load pages from DB:', error);
      dispatch({ type: 'SET_PAGES', pages: [] });
    }
  }, [dispatch, objectUrlsRef]);

  const loadImageUrl = useCallback(async (pageId: string): Promise<string | null> => {
    const cached = objectUrlsRef.current.get(pageId);
    if (cached) {
      touchCachedImage(pageId);
      return cached;
    }

    const pageIndex = state.pageIndexById[pageId];
    if (pageIndex === undefined) return null;
    const page = state.pages[pageIndex];
    if (!isPreviewableFileType(page.fileType)) return null;

    const blob = await db.getImageBlob(pageId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.set(pageId, url);
      touchCachedImage(pageId);
      evictCachedImages(new Set([pageId]));
      dispatch({ type: 'UPDATE_PAGE', id: pageId, updates: { imageUrl: url } });
      return url;
    }

    return null;
  }, [dispatch, evictCachedImages, objectUrlsRef, state.pageIndexById, state.pages, touchCachedImage]);

  const syncVisibleImages = useCallback(async (pageIds: string[]): Promise<void> => {
    const targetIds = new Set(pageIds.filter(Boolean));

    await Promise.all(Array.from(targetIds, async (pageId) => {
      if (objectUrlsRef.current.has(pageId)) {
        touchCachedImage(pageId);
        return;
      }

      const pageIndex = state.pageIndexById[pageId];
      if (pageIndex === undefined) return;
      const page = state.pages[pageIndex];
      if (!isPreviewableFileType(page.fileType)) return;

      const blob = await db.getImageBlob(pageId);
      if (!blob) return;

      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.set(pageId, url);
      touchCachedImage(pageId);
      dispatch({ type: 'UPDATE_PAGE', id: pageId, updates: { imageUrl: url } });
    }));

    evictCachedImages(targetIds);
  }, [dispatch, evictCachedImages, objectUrlsRef, state.pageIndexById, state.pages, touchCachedImage]);

  const prevPage = useCallback((): void => {
    if (currentIndex > 0) dispatch({ type: 'SET_CURRENT_INDEX', index: currentIndex - 1 });
  }, [currentIndex, dispatch]);

  const nextPage = useCallback((): void => {
    if (currentIndex >= 0 && currentIndex < pages.length - 1) {
      dispatch({ type: 'SET_CURRENT_INDEX', index: currentIndex + 1 });
    }
  }, [currentIndex, pages.length, dispatch]);

  return {
    pages,
    currentPage,
    currentIndex,
    selectedPageId,
    initialized,
    canGoPrev: currentIndex > 0,
    canGoNext: currentIndex >= 0 && currentIndex < pages.length - 1,
    totalPages: pages.length,
    processingCount,
    completedCount,
    addPage,
    addPages,
    deletePage,
    clearAll,
    selectPage,
    goTo,
    loadFromDB,
    loadImageUrl,
    syncVisibleImages,
    prevPage,
    nextPage,
  };
}
