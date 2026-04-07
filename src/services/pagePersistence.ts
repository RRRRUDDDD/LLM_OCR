import type { OcrResultRecord, StoredPage } from '../types/page';

export const PAGE_PERSIST_FLUSH_INTERVAL_MS = 75;

type ImageUpdateEntry = {
  id: string;
  updates: Partial<StoredPage>;
};

type OcrSaveEntry = {
  imageId: string;
  result: Pick<OcrResultRecord, 'text'> & Partial<Omit<OcrResultRecord, 'imageId' | 'text'>>;
};

type OcrOperation =
  | { type: 'save'; payload: OcrSaveEntry }
  | { type: 'delete'; imageId: string };

interface PersistenceDbLike {
  bulkUpdateImages: (entries: ImageUpdateEntry[]) => Promise<void>;
  bulkSaveOcrResults: (entries: OcrSaveEntry[]) => Promise<void>;
  bulkDeleteOcrResults: (imageIds: string[]) => Promise<void>;
}

export interface PagePersistenceBuffer {
  queueImageUpdate: (id: string, updates: Partial<StoredPage>) => void;
  queueOcrSave: (imageId: string, result: OcrSaveEntry['result']) => void;
  queueOcrDelete: (imageId: string) => void;
  flush: () => Promise<void>;
  dispose: () => Promise<void>;
}

export function createPagePersistenceBuffer(
  db: PersistenceDbLike,
  onError: (scope: string, error: unknown) => void,
  flushIntervalMs = PAGE_PERSIST_FLUSH_INTERVAL_MS,
): PagePersistenceBuffer {
  const imageUpdates = new Map<string, Partial<StoredPage>>();
  const ocrOperations = new Map<string, OcrOperation>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushInFlight: Promise<void> | null = null;
  let disposed = false;

  const scheduleFlush = () => {
    if (disposed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, flushIntervalMs);
  };

  const flush = async (): Promise<void> => {
    if (disposed) return;
    if (flushInFlight) {
      await flushInFlight;
      if (imageUpdates.size === 0 && ocrOperations.size === 0) return;
    }

    const imageEntries = Array.from(imageUpdates.entries()).map(([id, updates]) => ({ id, updates }));
    const ocrEntries = Array.from(ocrOperations.values());

    imageUpdates.clear();
    ocrOperations.clear();

    flushInFlight = (async () => {
      try {
        if (imageEntries.length > 0) {
          await db.bulkUpdateImages(imageEntries);
        }
      } catch (error) {
        onError('DB bulk image update failed', error);
      }

      try {
        const saves = ocrEntries
          .filter((entry): entry is Extract<OcrOperation, { type: 'save' }> => entry.type === 'save')
          .map((entry) => entry.payload);
        if (saves.length > 0) {
          await db.bulkSaveOcrResults(saves);
        }
      } catch (error) {
        onError('DB bulk OCR save failed', error);
      }

      try {
        const deletes = ocrEntries
          .filter((entry): entry is Extract<OcrOperation, { type: 'delete' }> => entry.type === 'delete')
          .map((entry) => entry.imageId);
        if (deletes.length > 0) {
          await db.bulkDeleteOcrResults(deletes);
        }
      } catch (error) {
        onError('DB bulk OCR delete failed', error);
      }
    })();

    await flushInFlight;
    flushInFlight = null;

    if (!disposed && (imageUpdates.size > 0 || ocrOperations.size > 0)) {
      scheduleFlush();
    }
  };

  return {
    queueImageUpdate(id, updates) {
      imageUpdates.set(id, { ...(imageUpdates.get(id) || {}), ...updates });
      scheduleFlush();
    },
    queueOcrSave(imageId, result) {
      ocrOperations.set(imageId, { type: 'save', payload: { imageId, result } });
      scheduleFlush();
    },
    queueOcrDelete(imageId) {
      ocrOperations.set(imageId, { type: 'delete', imageId });
      scheduleFlush();
    },
    flush,
    async dispose() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
      disposed = true;
    },
  };
}
