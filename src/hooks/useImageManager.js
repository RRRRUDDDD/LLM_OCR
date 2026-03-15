import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Manages image list, ObjectURL lifecycle, and current index.
 * Fix #1: ObjectURL memory leak — revokeObjectURL on cleanup.
 * Fix #5: Stale closure — countRef tracks latest count synchronously.
 */
export default function useImageManager() {
  const [images, setImages] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const objectUrlsRef = useRef([]);
  // Sync counter ref — always holds the true count, even before React re-renders
  const countRef = useRef(0);

  // Cleanup all ObjectURLs on unmount
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Returns the startIndex synchronously via ref (safe for rapid successive calls)
  const addImages = useCallback((files) => {
    const startIndex = countRef.current;
    const urls = files.map((f) => {
      const url = URL.createObjectURL(f);
      objectUrlsRef.current.push(url);
      return url;
    });
    countRef.current += urls.length;
    setImages((prev) => [...prev, ...urls]);
    return startIndex;
  }, []);

  // Returns the index of the newly added image
  const addSingleImage = useCallback((file) => {
    const index = countRef.current;
    const url = URL.createObjectURL(file);
    objectUrlsRef.current.push(url);
    countRef.current += 1;
    setImages((prev) => [...prev, url]);
    return index;
  }, []);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < images.length - 1;

  const prevImage = useCallback(() => setCurrentIndex((i) => Math.max(0, i - 1)), []);

  const nextImage = useCallback(() => {
    // Use countRef to read latest count without abusing setImages as a reader
    setCurrentIndex((i) => Math.min(countRef.current - 1, i + 1));
  }, []);

  const goTo = useCallback((index) => {
    setCurrentIndex(index);
  }, []);

  // Revoke all ObjectURLs and reset state
  const clearAll = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    countRef.current = 0;
    setImages([]);
    setCurrentIndex(0);
  }, []);

  return {
    images,
    currentIndex,
    canGoPrev,
    canGoNext,
    addImages,
    addSingleImage,
    prevImage,
    nextImage,
    goTo,
    clearAll,
  };
}
