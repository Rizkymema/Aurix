/**
 * Shared Hooks
 * ============
 * Centralized custom hooks for the trading dashboard.
 * Re-exports from component-specific hooks for convenience.
 */

// Chart hooks
export { useWebSocket } from '../components/chart/hooks/useWebSocket';
export { useChartResize } from '../components/chart/hooks/useChartResize';
export { useZoomPan } from '../components/chart/hooks/useZoomPan';

// Analysis hooks
export { useMarketAnalysis } from '../components/analysis/useMarketAnalysis';
export { useMarketStructure } from '../components/marketStructure/useMarketStructure';
export { useCandlePatterns } from '../components/candlePattern/useCandlePatterns';
export { useSupplyDemand } from '../components/supplyDemand/useSupplyDemand';

// Bot hooks
export { useBotDashboard } from '../components/botDashboard/useBotDashboard';

// Dashboard hooks
export { useDashboardData } from '../components/dashboard/useDashboardData';

// Calculator hooks
export { usePositionCalculator } from '../components/calculator/usePositionCalculator';

// Probability Engine hook
export { useProbabilityEngine } from './useProbabilityEngine';
