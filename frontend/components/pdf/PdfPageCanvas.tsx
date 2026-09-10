'use client';

import { useEffect, useRef, useCallback } from 'react';

interface PdfPageCanvasProps {
  /** Absolute URL or root-relative path to the PDF file */
  pdfUrl: string;
  /** 1-indexed page number to render */
  pageNumber: number;
  /** CSS (logical) pixel width the canvas should occupy */
  containerWidth: number;
  /** Called with the logical scale factor (containerWidth / PDF_PAGE_WIDTH) for overlay positioning */
  onScale?: (scale: number) => void;
  className?: string;
}

export function PdfPageCanvas({
  pdfUrl,
  pageNumber,
  containerWidth,
  onScale,
  className = '',
}: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const renderPage = useCallback(async () => {
    if (!canvasRef.current || containerWidth <= 0) return;

    // Dynamically import pdfjs-dist to keep it out of the server bundle.
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(pageNumber);

    const unscaledViewport = page.getViewport({ scale: 1 });

    // Logical scale: how much to scale the PDF to fill containerWidth in CSS pixels.
    const logicalScale = containerWidth / unscaledViewport.width;

    // Physical scale: multiply by DPR so each CSS pixel maps to dpr canvas pixels.
    // This produces a crisp render on Retina / high-DPI mobile screens.
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const physicalScale = logicalScale * dpr;
    const viewport = page.getViewport({ scale: physicalScale });

    // Report the LOGICAL scale to callers — overlays work in CSS pixel space.
    onScale?.(logicalScale);

    const canvas = canvasRef.current;
    if (!canvas) return;

    // Canvas intrinsic size = physical pixels (high-res).
    canvas.width  = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    // CSS display size = logical pixels so the element occupies the right amount of space.
    const cssHeight = Math.floor(containerWidth * (unscaledViewport.height / unscaledViewport.width));
    canvas.style.width  = `${containerWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Cancel any previous in-flight render.
    renderTaskRef.current?.cancel();
    const renderTask = page.render({ canvasContext: ctx, viewport, canvas });
    renderTaskRef.current = renderTask;
    try {
      await renderTask.promise;
    } catch (err: unknown) {
      // RenderingCancelledException is expected on rapid re-renders.
      if ((err as { name?: string }).name !== 'RenderingCancelledException') {
        console.error('[PdfPageCanvas] render error', err);
      }
    }
  }, [pdfUrl, pageNumber, containerWidth, onScale]);

  useEffect(() => {
    renderPage();
  }, [renderPage]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ display: 'block' }}
    />
  );
}
