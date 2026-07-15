'use client';

import React, { useState } from 'react';

interface MobileBotControlProps {
  status: 'running' | 'stopped' | 'error';
  mode: 'dry-run' | 'live';
  onStartAction: () => void;
  onStopAction: () => void;
  onModeChangeAction: (mode: 'dry-run' | 'live') => void;
  aiEnabled: boolean;
  onAiToggleAction: (enabled: boolean) => void;
}

export default function MobileBotControl({
  status,
  mode,
  onStartAction,
  onStopAction,
  onModeChangeAction,
  aiEnabled,
  onAiToggleAction
}: MobileBotControlProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isRunning = status === 'running';

  return (
    <div className="space-y-4">
      {/* Status Card */}
      <div className="bg-[#21262D] rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${
              status === 'running' ? 'bg-green-500 animate-pulse' :
              status === 'error' ? 'bg-red-500' : 'bg-gray-500'
            }`} />
            <span className="text-white font-medium capitalize">{status}</span>
          </div>
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            mode === 'live' ? 'bg-red-900 text-red-300' : 'bg-yellow-900 text-yellow-300'
          }`}>
            {mode.toUpperCase()}
          </span>
        </div>

        {/* Main Action Button */}
        <button
          onClick={isRunning ? onStopAction : onStartAction}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all
                     active:scale-[0.98] min-h-[56px]
                     ${isRunning 
                       ? 'bg-red-600 text-white active:bg-red-700' 
                       : 'bg-green-600 text-white active:bg-green-700'
                     }`}
        >
          {isRunning ? '⏹ Stop Bot' : '▶ Start Bot'}
        </button>
      </div>

      {/* Quick Settings */}
      <div className="bg-[#21262D] rounded-xl p-4 space-y-4">
        {/* Mode Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-gray-300">Mode</span>
          <div className="flex rounded-lg overflow-hidden">
            <button
              onClick={() => onModeChangeAction('dry-run')}
              className={`px-4 py-2 text-sm font-medium min-h-[44px] transition-colors
                         ${mode === 'dry-run' 
                           ? 'bg-yellow-600 text-white' 
                           : 'bg-[#30363D] text-gray-400'
                         }`}
            >
              DRY-RUN
            </button>
            <button
              onClick={() => onModeChangeAction('live')}
              className={`px-4 py-2 text-sm font-medium min-h-[44px] transition-colors
                         ${mode === 'live' 
                           ? 'bg-red-600 text-white' 
                           : 'bg-[#30363D] text-gray-400'
                         }`}
            >
              LIVE
            </button>
          </div>
        </div>

        {/* AI Toggle */}
        <div className="flex items-center justify-between">
          <span className="text-gray-300">AI Analysis</span>
          <button
            onClick={() => onAiToggleAction(!aiEnabled)}
            className={`relative w-14 h-8 rounded-full transition-colors ${
              aiEnabled ? 'bg-pink-600' : 'bg-[#30363D]'
            }`}
          >
            <span className={`absolute top-1 w-6 h-6 rounded-full bg-white 
                             transition-transform ${aiEnabled ? 'left-7' : 'left-1'}`} 
            />
          </button>
        </div>
      </div>

      {/* Advanced Settings (Collapsible) */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="w-full flex items-center justify-between px-4 py-3 
                   bg-[#21262D] rounded-xl text-gray-400"
      >
        <span>Advanced Settings</span>
        <svg 
          className={`w-5 h-5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} 
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {showAdvanced && (
        <div className="bg-[#21262D] rounded-xl p-4 space-y-3 text-sm">
          <div className="flex justify-between text-gray-400">
            <span>Risk per Trade</span>
            <span className="text-white">1%</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Max Open Trades</span>
            <span className="text-white">3</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Take Profit</span>
            <span className="text-white">2:1 RRR</span>
          </div>
        </div>
      )}
    </div>
  );
}
