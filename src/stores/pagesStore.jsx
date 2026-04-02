import { createContext, useContext, useReducer, useCallback, useRef, useEffect, useMemo } from 'react';
import { db, generateId } from '../db/index';
import { ocrEvents } from '../events/ocrEvents';
import { dbLogger } from '../utils/logger';

/**
 * Page-centric state model (borrowed from DeepSeek-OCR-WebUI's usePagesStore)
 *
 * Replaces the old parallel arrays (images[], results[], statuses[]) with a unified
 * pages[] where each page is an independent unit with its own status, result, and logs.
 *
 * Status machine:
 *   idle -> queued -> processing -> done | error
 */

// ── Status Constants ──
export const PAGE_STATUS = {
  IDLE: 'idle',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  DONE: 'done',
  ERROR: 'error',
};

// ── Reducer ──
function pagesReducer(state, action) {
  switch (action.type) {
    case 'SET_PAGES':
      return { ...state, pages: action.pages, initialized: true };

    case 'ADD_PAGE': {
      const pages = [...state.pages, action.page];
      return { ...state, pages };
    }

    case 'UPDATE_PAGE': {
      const pages = state.pages.map((p) =>
        p.id === action.id ? { ...p, ...action.updates, updatedAt: new Date() } : p
      );
      return { ...state, pages };
    }

    case 'DELETE_PAGES': {
      const ids = new Set(action.ids);
      const pages = state.pages.filter((p) => !ids.has(p.id));
      const selectedId = ids.has(state.selectedPageId) ? (pages[0]?.id ?? null) : state.selectedPageId;
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

const initialState = {
  pages: [],
  selectedPageId: null,
  initialized: false,
};

// ── Context ──
const PagesContext = createContext(null);
const PagesDispatchContext = createContext(null);

export function PagesProvider({ children }) {
  const [state, dispatch] = useReducer(pagesReducer, initialState);
  const objectUrlsRef = useRef(new Map()); // id -> objectURL

  // Listen to OCR events and sync state
  useEffect(() => {
    const handlers = {
      'ocr:queued': ({ imageId }) => {
        dispatch({ type: 'UPDATE_PAGE', id: imageId, updates: { status: PAGE_STATUS.QUEUED } });
        db.updateImage(imageId, { status: PAGE_STATUS.QUEUED }).catch((e) => dbLogger.error('DB update failed:', e));
      },
      'ocr:start': ({ imageId }) => {
        dispatch({ type: 'UPDATE_PAGE', id: imageId, updates: { status: PAGE_STATUS.PROCESSING } });
        db.updateImage(imageId, { status: PAGE_STATUS.PROCESSING }).catch((e) => dbLogger.error('DB update failed:', e));
      },
      'ocr:progress': ({ imageId, text }) => {
        dispatch({ type: 'UPDATE_PAGE', id: imageId, updates: { ocrText: text } });
      },
      'ocr:success': ({ imageId, text }) => {
        dispatch({
          type: 'UPDATE_PAGE',
          id: imageId,
          updates: { status: PAGE_STATUS.DONE, ocrText: text },
        });
        db.updateImage(imageId, { status: PAGE_STATUS.DONE, ocrText: text }).catch((e) => dbLogger.error('DB update failed:', e));
        db.saveOcrResult(imageId, { text, status: 'done', createdAt: new Date() }).catch((e) => dbLogger.error('DB save OCR failed:', e));
      },
      'ocr:error': ({ imageId, error }) => {
        const msg = error?.message || String(error);
        dispatch({
          type: 'UPDATE_PAGE',
          id: imageId,
          updates: { status: PAGE_STATUS.ERROR, ocrText: `Error: ${msg}` },
        });
        db.updateImage(imageId, { status: PAGE_STATUS.ERROR }).catch((e) => dbLogger.error('DB update failed:', e));
      },
      'ocr:cancelled': ({ imageId }) => {
        dispatch({
          type: 'UPDATE_PAGE',
          id: imageId,
          updates: { status: PAGE_STATUS.IDLE },
        });
        db.updateImage(imageId, { status: PAGE_STATUS.IDLE }).catch((e) => dbLogger.error('DB update failed:', e));
      },
    };

    for (const [event, handler] of Object.entries(handlers)) {
      ocrEvents.on(event, handler);
    }

    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        ocrEvents.off(event, handler);
      }
    };
  }, []);

  // Cleanup object URLs on unmount
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

// ── Hooks ──

export function usePagesState() {
  const ctx = useContext(PagesContext);
  if (!ctx) throw new Error('usePagesState must be used within PagesProvider');
  return ctx.state;
}

export function usePagesDispatch() {
  const dispatch = useContext(PagesDispatchContext);
  if (!dispatch) throw new Error('usePagesDispatch must be used within PagesProvider');
  return dispatch;
}

/**
 * Main hook for page operations.
 */
export function usePages() {
  const { state, objectUrlsRef } = useContext(PagesContext);
  const dispatch = useContext(PagesDispatchContext);

  const { pages, selectedPageId, initialized } = state;

  const currentIndex = pages.findIndex((p) => p.id === selectedPageId);
  const currentPage = pages[currentIndex] ?? null;
  const processingCount = useMemo(() => pages.filter((p) => p.status === PAGE_STATUS.PROCESSING || p.status === PAGE_STATUS.QUEUED).length, [pages]);
  const completedCount = useMemo(() => pages.filter((p) => p.status === PAGE_STATUS.DONE).length, [pages]);

  const addPage = useCallback(async (file) => {
    const id = generateId('img');
    const objectUrl = URL.createObjectURL(file);
    objectUrlsRef.current.set(id, objectUrl);

    const page = {
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

    // Persist to IndexedDB
    try {
      await db.saveImage(page);
      await db.saveImageBlob(id, file);
    } catch (e) {
      dbLogger.error('Failed to persist page:', e);
    }

    return page;
  }, [dispatch, objectUrlsRef]);

  const addPages = useCallback(async (files) => {
    const newPages = [];
    for (const file of files) {
      const page = await addPage(file);
      newPages.push(page);
    }
    return newPages;
  }, [addPage]);

  const deletePage = useCallback(async (id) => {
    const url = objectUrlsRef.current.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(id);
    }
    dispatch({ type: 'DELETE_PAGES', ids: [id] });
    await db.deleteImage(id).catch((e) => dbLogger.error('DB delete failed:', e));
  }, [dispatch, objectUrlsRef]);

  const clearAll = useCallback(async () => {
    for (const url of objectUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current.clear();
    dispatch({ type: 'CLEAR_ALL' });
    await db.deleteAllImages().catch((e) => dbLogger.error('DB clear failed:', e));
  }, [dispatch, objectUrlsRef]);

  const selectPage = useCallback((id) => {
    dispatch({ type: 'SELECT_PAGE', id });
  }, [dispatch]);

  const goTo = useCallback((index) => {
    dispatch({ type: 'SET_CURRENT_INDEX', index });
  }, [dispatch]);

  const loadFromDB = useCallback(async () => {
    try {
      const saved = await db.getAllImages();
      const loadedPages = saved.map((img) => ({
        ...img,
        imageUrl: '', // Will be populated from blob below
        status: img.status || PAGE_STATUS.IDLE,
        ocrText: img.ocrText || '',
      }));
      dispatch({ type: 'SET_PAGES', pages: loadedPages });

      // Restore image URLs and OCR results for all pages
      for (const page of loadedPages) {
        // Load image blob -> create objectURL
        const blob = await db.getImageBlob(page.id);
        if (blob) {
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.set(page.id, url);
          dispatch({ type: 'UPDATE_PAGE', id: page.id, updates: { imageUrl: url } });
        }

        // Load OCR result
        const result = await db.getOcrResult(page.id);
        if (result?.text) {
          dispatch({
            type: 'UPDATE_PAGE',
            id: page.id,
            updates: { ocrText: result.text, status: PAGE_STATUS.DONE },
          });
        }
      }
    } catch (e) {
      dbLogger.error('Failed to load pages from DB:', e);
      dispatch({ type: 'SET_PAGES', pages: [] });
    }
  }, [dispatch]);

  /**
   * Load image blob from IndexedDB and create object URL (for persisted pages).
   */
  const loadImageUrl = useCallback(async (pageId) => {
    if (objectUrlsRef.current.has(pageId)) {
      return objectUrlsRef.current.get(pageId);
    }
    const blob = await db.getImageBlob(pageId);
    if (blob) {
      const url = URL.createObjectURL(blob);
      objectUrlsRef.current.set(pageId, url);
      dispatch({ type: 'UPDATE_PAGE', id: pageId, updates: { imageUrl: url } });
      return url;
    }
    return null;
  }, [dispatch, objectUrlsRef]);

  const prevPage = useCallback(() => {
    const idx = pages.findIndex((p) => p.id === selectedPageId);
    if (idx > 0) dispatch({ type: 'SET_CURRENT_INDEX', index: idx - 1 });
  }, [pages, selectedPageId, dispatch]);

  const nextPage = useCallback(() => {
    const idx = pages.findIndex((p) => p.id === selectedPageId);
    if (idx < pages.length - 1) dispatch({ type: 'SET_CURRENT_INDEX', index: idx + 1 });
  }, [pages, selectedPageId, dispatch]);

  return {
    // State
    pages,
    currentPage,
    currentIndex,
    selectedPageId,
    initialized,

    // Derived
    canGoPrev: currentIndex > 0,
    canGoNext: currentIndex < pages.length - 1,
    totalPages: pages.length,
    processingCount,
    completedCount,

    // Actions
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
