'use client';

import React from 'react';

type TabType = 'chart' | 'signals' | 'bot' | 'settings';

interface MobileNavProps {
  activeTab: TabType;
  onTabChangeAction: (tab: TabType) => void;
}

const TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  {
    id: 'chart',
    label: 'Chart',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16h16V4H4z" />
      </svg>
    )
  },
  {
    id: 'signals',
    label: 'Signals',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    )
  },
  {
    id: 'bot',
    label: 'Bot',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    )
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )
  }
];

export default function MobileNav({ activeTab, onTabChangeAction }: MobileNavProps) {
  return (
    <nav className="bg-[#161B22] border-t border-[#21262D] 
                    flex items-center justify-around h-14 pb-safe">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChangeAction(tab.id)}
          className={`flex flex-col items-center justify-center 
                     min-w-[64px] min-h-[48px] rounded-lg transition-colors
                     ${activeTab === tab.id 
                       ? 'text-blue-500' 
                       : 'text-gray-500 active:text-gray-300'
                     }`}
        >
          {tab.icon}
          <span className="text-xs mt-0.5">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
