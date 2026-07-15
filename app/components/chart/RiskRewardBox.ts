/**
 * Risk/Reward Box Visualizer
 * ===========================
 * Draws green/red boxes on chart for Long/Short signals
 * using lightweight-charts primitive API
 */

import { CHART_COLORS } from './types';

export interface RRBoxConfig {
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2?: number;
  positionType: 'LONG' | 'SHORT';
  startTime: number;
  endTime?: number;
}

export interface RRBoxColors {
  profit: string;
  profitBg: string;
  loss: string;
  lossBg: string;
  entry: string;
}

export const DEFAULT_RR_COLORS: RRBoxColors = {
  profit: CHART_COLORS.takeProfit1,
  profitBg: `${CHART_COLORS.takeProfit1}20`,
  loss: CHART_COLORS.stopLoss,
  lossBg: `${CHART_COLORS.stopLoss}20`,
  entry: CHART_COLORS.entry,
};

/**
 * Creates a custom series view for drawing RR boxes
 * This is a plugin pattern for lightweight-charts v5
 */
export class RiskRewardBoxRenderer {
  private _boxes: RRBoxConfig[] = [];
  private _colors: RRBoxColors = DEFAULT_RR_COLORS;

  constructor(colors?: Partial<RRBoxColors>) {
    if (colors) {
      this._colors = { ...DEFAULT_RR_COLORS, ...colors };
    }
  }

  /**
   * Add a new RR box to render
   */
  addBox(config: RRBoxConfig): void {
    this._boxes.push(config);
  }

  /**
   * Clear all boxes
   */
  clearBoxes(): void {
    this._boxes = [];
  }

  /**
   * Update boxes array
   */
  setBoxes(boxes: RRBoxConfig[]): void {
    this._boxes = boxes;
  }

  /**
   * Get all boxes
   */
  getBoxes(): RRBoxConfig[] {
    return [...this._boxes];
  }

  /**
   * Draw boxes on canvas
   * Call this from chart's subscribeCustomPrimitiveHitTest or similar
   */
  draw(
    ctx: CanvasRenderingContext2D,
    timeToCoord: (time: number) => number | null,
    priceToCoord: (price: number) => number | null,
    canvasWidth: number
  ): void {
    for (const box of this._boxes) {
      this._drawSingleBox(ctx, box, timeToCoord, priceToCoord, canvasWidth);
    }
  }

  private _drawSingleBox(
    ctx: CanvasRenderingContext2D,
    box: RRBoxConfig,
    timeToCoord: (time: number) => number | null,
    priceToCoord: (price: number) => number | null,
    canvasWidth: number
  ): void {
    const entryY = priceToCoord(box.entryPrice);
    const slY = priceToCoord(box.stopLoss);
    const tp1Y = priceToCoord(box.takeProfit1);
    const tp2Y = box.takeProfit2 ? priceToCoord(box.takeProfit2) : null;

    if (entryY === null || slY === null || tp1Y === null) return;

    const startX = timeToCoord(box.startTime);
    const endX = box.endTime ? timeToCoord(box.endTime) : canvasWidth;

    if (startX === null || endX === null) return;

    const boxWidth = Math.max(endX - startX, 100);

    // Draw PROFIT zone (green box)
    ctx.fillStyle = this._colors.profitBg;
    ctx.strokeStyle = this._colors.profit;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 2]);

    if (box.positionType === 'LONG') {
      // Long: profit is above entry
      const profitHeight = entryY - tp1Y;
      ctx.fillRect(startX, tp1Y, boxWidth, profitHeight);
      ctx.strokeRect(startX, tp1Y, boxWidth, profitHeight);

      // TP2 extended box (lighter)
      if (tp2Y !== null) {
        ctx.fillStyle = `${this._colors.profit}10`;
        const tp2Height = tp1Y - tp2Y;
        ctx.fillRect(startX, tp2Y, boxWidth, tp2Height);
        ctx.strokeRect(startX, tp2Y, boxWidth, tp2Height);
      }
    } else {
      // Short: profit is below entry
      const profitHeight = tp1Y - entryY;
      ctx.fillRect(startX, entryY, boxWidth, profitHeight);
      ctx.strokeRect(startX, entryY, boxWidth, profitHeight);

      // TP2 extended box
      if (tp2Y !== null) {
        ctx.fillStyle = `${this._colors.profit}10`;
        const tp2Height = tp2Y - tp1Y;
        ctx.fillRect(startX, tp1Y, boxWidth, tp2Height);
        ctx.strokeRect(startX, tp1Y, boxWidth, tp2Height);
      }
    }

    // Draw LOSS zone (red box)
    ctx.fillStyle = this._colors.lossBg;
    ctx.strokeStyle = this._colors.loss;
    ctx.setLineDash([4, 2]);

    if (box.positionType === 'LONG') {
      // Long: loss is below entry
      const lossHeight = slY - entryY;
      ctx.fillRect(startX, entryY, boxWidth, lossHeight);
      ctx.strokeRect(startX, entryY, boxWidth, lossHeight);
    } else {
      // Short: loss is above entry
      const lossHeight = entryY - slY;
      ctx.fillRect(startX, slY, boxWidth, lossHeight);
      ctx.strokeRect(startX, slY, boxWidth, lossHeight);
    }

    // Draw ENTRY line (solid blue)
    ctx.strokeStyle = this._colors.entry;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(startX, entryY);
    ctx.lineTo(startX + boxWidth, entryY);
    ctx.stroke();

    // Labels
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';

    // Entry label
    ctx.fillStyle = this._colors.entry;
    ctx.fillText(`ENTRY ${box.entryPrice.toFixed(2)}`, startX + 5, entryY - 5);

    // SL label
    ctx.fillStyle = this._colors.loss;
    ctx.fillText(`SL ${box.stopLoss.toFixed(2)}`, startX + 5, slY + 12);

    // TP1 label
    ctx.fillStyle = this._colors.profit;
    ctx.fillText(`TP1 ${box.takeProfit1.toFixed(2)}`, startX + 5, tp1Y + (box.positionType === 'LONG' ? -5 : 12));

    // TP2 label
    if (tp2Y !== null && box.takeProfit2) {
      ctx.fillText(`TP2 ${box.takeProfit2.toFixed(2)}`, startX + 5, tp2Y + (box.positionType === 'LONG' ? -5 : 12));
    }

    // Reset line dash
    ctx.setLineDash([]);
  }
}

/**
 * Helper to create RR box config from signal
 */
export function createRRBoxFromSignal(
  signal: {
    type: 'BUY' | 'SELL';
    entry_zone: { high: number; low: number };
    sl: number;
    tp1: number;
    tp2?: number;
  },
  startTime: number
): RRBoxConfig {
  const entryPrice = (signal.entry_zone.high + signal.entry_zone.low) / 2;
  
  return {
    entryPrice,
    stopLoss: signal.sl,
    takeProfit1: signal.tp1,
    takeProfit2: signal.tp2,
    positionType: signal.type === 'BUY' ? 'LONG' : 'SHORT',
    startTime,
  };
}

export default RiskRewardBoxRenderer;
