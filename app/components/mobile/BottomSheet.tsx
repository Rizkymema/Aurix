'use client';

import React, { useRef } from 'react';

type SheetHeight = 'collapsed' | 'half' | 'full';

interface BottomSheetProps {
  isOpen: boolean;
  height: SheetHeight;
  onHeightChangeAction: (height: SheetHeight) => void;
  onCloseAction: () => void;
  title: string;
  children: React.ReactNode;
}

const HEIGHT_MAP: Record<SheetHeight, string> = {
  collapsed: '0%',
  half: '50%',
  full: '85%'
};

export default function BottomSheet({
  isOpen,
  height,
  onHeightChangeAction,
  onCloseAction,
  title,
  children
}: BottomSheetProps) {
  const startY = useRef(0);
  const currentY = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    currentY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    const diff = currentY.current - startY.current;
    
    if (diff > 50) {
      // Swiped down
      if (height === 'full') {
        onHeightChangeAction('half');
      } else {
        onCloseAction();
      }
    } else if (diff < -50) {
      // Swiped up
      if (height === 'half') {
        onHeightChangeAction('full');
      }
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 transition-opacity"
        onClick={onCloseAction}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-14 left-0 right-0 bg-[#161B22] rounded-t-2xl z-50 
                   transition-all duration-300 ease-out overflow-hidden border-t border-[#21262D]"
        style={{ height: HEIGHT_MAP[height] }}
      >
        {/* Drag Handle */}
        <div
          className="flex flex-col items-center pt-2 pb-3 cursor-grab active:cursor-grabbing bg-[#0D1117]"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="w-10 h-1 bg-gray-600 rounded-full" />
          <span className="text-sm font-medium text-gray-400 mt-2">{title}</span>
        </div>

        {/* Content */}
        <div className="overflow-y-auto h-full pb-4 px-4">
          {children}
        </div>
      </div>
    </>
  );
}
