import { useState, useEffect, useRef, useCallback } from 'react';

export default function useImageManager() {
  const [images, setImages] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const objectUrlsRef = useRef([]);
  const countRef = useRef(0);

  // 组件卸载时清理所有 ObjectURL
  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

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

  // 返回新添加图片的索引
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
    // 通过 countRef 读取最新计数，避免将 setImages 用作读取器
    setCurrentIndex((i) => Math.min(countRef.current - 1, i + 1));
  }, []);

  const goTo = useCallback((index) => {
    setCurrentIndex(index);
  }, []);

  // 撤销所有 ObjectURL 并重置状态
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
