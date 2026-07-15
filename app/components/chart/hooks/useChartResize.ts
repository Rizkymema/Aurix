'use client';

import { useEffect, useCallback, RefObject, useRef } from 'react';
import { IChartApi } from 'lightweight-charts';

interface UseChartResizeOptions {
  chartRef: RefObject<IChartApi | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function useChartResize({ chartRef, containerRef }: UseChartResizeOptions) {
  // ✅ FIX: Store pending RAF id to cancel on unmount
  const pendingFrameRef = useRef<number | null>(null);

  const handleResize = useCallback(() => {
    if (chartRef.current && containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      chartRef.current.applyOptions({
        width,
        height,
      });
      chartRef.current.timeScale().fitContent();
    }
  }, [chartRef, containerRef]);

  useEffect(() => {
    // Initial resize
    handleResize();

    // Create ResizeObserver for container resize detection
    const resizeObserver = new ResizeObserver(() => {
      // ✅ FIX: Cancel previous RAF before queuing new one
      if (pendingFrameRef.current !== null) {
        cancelAnimationFrame(pendingFrameRef.current);
      }
      
      // Queue resize with RAF for smooth rendering
      pendingFrameRef.current = requestAnimationFrame(() => {
        handleResize();
        pendingFrameRef.current = null;  // Clear after execution
      });
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    // Also listen to window resize
    const handleWindowResize = () => {
      // ✅ FIX: Cancel previous RAF on window resize too
      if (pendingFrameRef.current !== null) {
        cancelAnimationFrame(pendingFrameRef.current);
      }
      
      pendingFrameRef.current = requestAnimationFrame(() => {
        handleResize();
        pendingFrameRef.current = null;
      });
    };
    
    window.addEventListener('resize', handleWindowResize);

    return () => {
      // ✅ FIX: Cancel pending RAF on unmount
      if (pendingFrameRef.current !== null) {
        cancelAnimationFrame(pendingFrameRef.current);
        pendingFrameRef.current = null;
      }
      
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [handleResize, containerRef]);

  return { handleResize };
}
