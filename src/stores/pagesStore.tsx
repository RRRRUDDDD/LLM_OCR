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

interface PagesState {
  pages: Page[];
  selectedPageId: string | null;
  initialized: boolean;
}

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
  prevPage: () => void;
  nextPage: () => void;
}

function pagesReducer(state: PagesState, action: PagesAction): PagesState {
  switch (action.type) {
    case 'SET_PAGES':
      return {
        ...state,
        pages: action.pages,
        selectedPageId: action.pages.some((page) => page.id === state.selectedPageId)
          ? state.selectedPageId
          : (action.pages[0]?.id ?? null),
        initialized: true,
      };

    case 'ADD_PAGE':
      return { ...state, pages: [...state.pages, action.page] };

    case 'UPDATE_PAGE':
      return {
        ...state,
        pages: state.pages.map((page) =>
          page.id === action.id ? { ...page, ...action.updates, updatedAt: new Date() } : page
        ),
      };

    case 'DELETE_PAGES': {
      const ids = new Set(action.ids);
      const pages = state.pages.filter((page) => !ids.has(page.id));
      const selectedId = ids.has(state.selectedPageId ?? '') ? (pages[0]?.id ?? null) : state.selectedPageId;
      return { ...state, pages, selectedPageId: selectedId };
    }

    case 'CLEAR_ALL':
      return { ...state, pages: [], selectedPageId: null };

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
  initialized: false,
};

const PagesContext = createContext<PagesContextValue | null>(null);
const PagesDispatchContext = createContext<Dispatch<PagesAction> | null>(null);

export function PagesProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(pagesReducer, initialState);
  const objectUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const handleQueued = ({ imageId }: OcrEventMap['ocr:queued']) => {
      dispatch({ type: 'UPDATE_PAGE', id: imageId, updates: { status: PAGE_STATUS.QUEUED } });
      db.updateImage(imageId, { status: PAGE_STATUS.QUEUED }).catch((error) => dbLogger.error('DB update failed:', error));
    };

    const handleStart = ({ imageId }: OcrEventMap['ocr:start']) => {
      dispatch({ type: 'UPDATE_PAGE', id: imageId, updates: { status: PAGE_STATUS.PROCESSING } });
      db.updateImage(imageId, { status: PAGE_STATUS.PROCESSING }).catch((error) => dbLogger.error('DB update failed:', error));
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
      db.updateImage(imageId, { status: PAGE_STATUS.DONE, ocrText: text }).catch((error) => dbLogger.error('DB update failed:', error));
      db.saveOcrResult(imageId, { text, rawText: text, status: PAGE_STATUS.DONE, createdAt: new Date() }).catch((error) => dbLogger.error('DB save OCR failed:', error));
    };

    const handleError = ({ imageId, error }: OcrEventMap['ocr:error']) => {
      const message = error.message || String(error);
      dispatch({
        type: 'UPDATE_PAGE',
        id: imageId,
        updates: { status: PAGE_STATUS.ERROR, ocrText: `Error: ${message}` },
      });
      db.updateImage(imageId, { status: PAGE_STATUS.ERROR, ocrText: `Error: ${message}` }).catch((dbError) => dbLogger.error('DB update failed:', dbError));
      db.deleteOcrResult(imageId).catch((dbError) => dbLogger.error('DB delete OCR failed:', dbError));
    };

    const handleCancelled = ({ imageId }: OcrEventMap['ocr:cancelled']) => {
      dispatch({
        type: 'UPDATE_PAGE',
        id: imageId,
        updates: { status: PAGE_STATUS.IDLE, ocrText: '' },
      });
      db.updateImage(imageId, { status: PAGE_STATUS.IDLE, ocrText: '' }).catch((error) => dbLogger.error('DB update failed:', error));
      db.deleteOcrResult(imageId).catch((error) => dbLogger.error('DB delete OCR failed:', error));
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
  const { pages, selectedPageId, initialized } = state;

  const currentIndex = pages.findIndex((page) => page.id === selectedPageId);
  const currentPage = currentIndex >= 0 ? pages[currentIndex] : null;
  const processingCount = useMemo(
    () => pages.filter((page) => page.status === PAGE_STATUS.PROCESSING || page.status === PAGE_STATUS.QUEUED).length,
    [pages]
  );
  const completedCount = useMemo(
    () => pages.filter((page) => page.status === PAGE_STATUS.DONE).length,
    [pages]
  );

  const addPage = useCallback(async (file: File): Promise<Page> => {
    const id = generateId('img');
    const objectUrl = URL.createObjectURL(file);
    objectUrlsRef.current.set(id, objectUrl);

    const page: Page = {
      id,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      status: PAGE_STATUS.IDLE,
      ocrText: '',
      imageUrl: objectUrl,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    dispatch({ type: 'ADD_PAGE', page });

    try {
      await db.saveImage(page);
      await db.saveImageBlob(id, file);
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
      const saved = await db.getAllImages();
      const loadedPages: Page[] = saved.map((image: StoredPage) => ({
        ...image,
        imageUrl: '',
        status: image.status || PAGE_STATUS.IDLE,
        ocrText: image.ocrText || '',
      }));
      dispatch({ type: 'SET_PAGES', pages: loadedPages });

      for (const page of loadedPages) {
        const blob = await db.getImageBlob(page.id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.set(page.id, url);
          dispatch({ type: 'UPDATE_PAGE', id: page.id, updates: { imageUrl: url } });
        }

        const result = await db.getOcrResult(page.id);
        if (result?.text) {
          dispatch({
            type: 'UPDATE_PAGE',
            id: page.id,
            updates: { ocrText: result.text, status: PAGE_STATUS.DONE },
          });
        }
      }
    } catch (error) {
      dbLogger.error('Failed to load pages from DB:', error);
      dispatch({ type: 'SET_PAGES', pages: [] });
    }
  }, [dispatch, objectUrlsRef]);

  const loadImageUrl = useCallback(async (pageId: string): Promise<string | null> => {
    const cached = objectUrlsRef.current.get(pageId);
    if (cached) return cached;

    const blob = await db.getImageBlob(pageId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.set(pageId, url);
      dispatch({ type: 'UPDATE_PAGE', id: pageId, updates: { imageUrl: url } });
      return url;
    }

    return null;
  }, [dispatch, objectUrlsRef]);

  const prevPage = useCallback((): void => {
    const idx = pages.findIndex((page) => page.id === selectedPageId);
    if (idx > 0) dispatch({ type: 'SET_CURRENT_INDEX', index: idx - 1 });
  }, [pages, selectedPageId, dispatch]);

  const nextPage = useCallback((): void => {
    const idx = pages.findIndex((page) => page.id === selectedPageId);
    if (idx >= 0 && idx < pages.length - 1) dispatch({ type: 'SET_CURRENT_INDEX', index: idx + 1 });
  }, [pages, selectedPageId, dispatch]);

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
    prevPage,
    nextPage,
  };
}
