const logger = require('../utils/logger');
const MultiTimeframeIndicatorState = require('../services/MultiTimeframeIndicatorState');

/**
 * GridTradingStrategyV2 - Multi-timeframe grid trading
 * Uses dynamic grid levels based on ATR and trend alignment.
 * Adapts grid spacing to market volatility.
 */
class GridTradingStrategyV2 {
  constructor(config = {}) {
    this.name = 'Grid Trading v2';
    this.description = 'Multi-timeframe grid with adaptive ATR-based spacing';
    
    this.config = {
      primaryTimeframe: config.primaryTimeframe || '15m',
      timeframes: config.timeframes || ['15m', '1h', '4h'],
      
      // Grid parameters
      gridLevels: config.gridLevels || 10,
      gridSpacingAtrMultiplier: config.gridSpacingAtrMultiplier || 1.5,
      maxGrids: config.maxGrids || 20,
      
      // Trend filter
      useTrendFilter: config.useTrendFilter !== false,
      minTrendStrength: config.minTrendStrength || 20,
      
      // Risk parameters
      basePositionSize: config.basePositionSize || 0.05, // 5% per grid
      maxPositionSize: config.maxPositionSize || 0.5,   // 50% total for grid
      stopLossAtrMultiplier: config.stopLossAtrMultiplier || 5,
      
      // Exit conditions
      stopLossAtrMultiplier: config.stopLossAtrMultiplier || 5.0, // 5x ATR for hard stop
      trailingStopAtrMultiplier: config.trailingStopAtrMultiplier || 1.5, // 1.5x ATR for trailing stop
      
      ...config
    };
    
    this.indicatorStates = new Map();
    this.grids = new Map(); // pair -> Array of grid levels
    this.activePositions = new Map(); // pair -> Array of filled grid levels
    
    this.signals = [];
    this.trades = [];
    this.position = null; // Track overall position for exit logic
  }

  initializePair(pair) {
    if (!this.indicatorStates.has(pair)) {
      this.indicatorStates.set(pair, new MultiTimeframeIndicatorState(this.config.timeframes));
      logger.info(`GridTradingStrategyV2 initialized for ${pair}`);
    }
    return this.indicatorStates.get(pair);
  }

  update(candle, pair) {
    const state = this.initializePair(pair);
    state.update(candle);
  }

  async generateSignal(marketData) {
    try {
      const { pair, price, timestamp, indicators } = marketData;
      const state = this.initializePair(pair);
      
      // Use provided indicators if available (for tests/legacy compatibility)
      let snapshot;
      if (indicators && indicators.warmedUp) {
        snapshot = { ...indicators, overallWarmedUp: true };
      } else {
        snapshot = state.getSnapshot();
      }
      
      if (!snapshot.overallWarmedUp && !indicators) {
        return { action: 'hold', confidence: 0, reason: 'Warming up...', strategy: this.name };
      }

      // Check trend alignment - avoid gridding against strong trends
      if (this.config.useTrendFilter) {
        const trend = snapshot.trendAlignment;
        if (trend === 'strong_uptrend' || trend === 'strong_downtrend') {
          // If we have no positions, don't start a new grid in a strong trend
          if (!this.activePositions.get(pair)?.length) {
            return { action: 'hold', confidence: 0, reason: `Strong trend detected (${trend}), inhibiting grid start`, strategy: this.name };
          }
        }
      }
      
      // Check for exits on current positions
      const exitSignal = this.checkExitConditions(pair, price, state);
      if (exitSignal) return exitSignal;

      // Initialize or update grid levels if needed
      if (!this.grids.has(pair) || this.shouldRebalance(pair, price, state)) {
        this.rebalanceGrid(pair, price, state);
      }

      const gridLevels = this.grids.get(pair);
      const activeLevels = this.activePositions.get(pair) || [];
      
      // Check each grid level for BUY entry
      const signals = [];
      
      for (const level of gridLevels) {
        const isActive = activeLevels.some(l => l.price === level.price);
        
        // Buy if price drops below a level we don't hold
        if (!isActive && price <= level.price && level.type === 'buy') {
          signals.push({
            action: 'buy',
            confidence: 0.8,
            reason: `Price ${price} hit buy grid level ${level.price}`,
            strategy: this.name,
            pair,
            price: level.price,
            amount: this.config.basePositionSize,
            gridLevel: level.price
          });
        }
      }
      
      // If we have an entry signal, record it
      if (signals.length > 0) {
        this.signals.push(...signals);
        if (this.signals.length > 1000) this.signals.splice(0, signals.length);
        return signals[0]; 
      }

      return { action: 'hold', confidence: 0, reason: 'No entry levels hit', strategy: this.name };
      
    } catch (error) {
      logger.error('GridTradingStrategyV2 error:', error);
      return { action: 'hold', confidence: 0, reason: 'Error', strategy: this.name };
    }
  }

  checkExitConditions(pair, price, state) {
    const activeLevels = this.activePositions.get(pair) || [];
    if (activeLevels.length === 0) return null;
    
    const atr = state.getATR(this.config.primaryTimeframe, 14);
    
    for (const level of activeLevels) {
      // 1. Hard Stop Loss (based on ATR)
      const stopLossPrice = level.price * (1 - this.config.stopLossAtrMultiplier * (atr / level.price));
      if (price <= stopLossPrice) {
        return {
          action: 'sell',
          confidence: 1.0,
          reason: `Grid hard stop loss hit at ${price} for level ${level.price}`,
          strategy: this.name,
          pair, price, amount: this.config.basePositionSize // Sell one grid unit
        };
      }
      
      // 2. Trailing Stop (based on ATR)
      const trailingStopPrice = level.sellPrice * (1 - this.config.trailingStopAtrMultiplier * (atr / level.sellPrice));
      if (price <= trailingStopPrice) {
        return {
          action: 'sell',
          confidence: 0.9,
          reason: `Grid trailing stop hit at ${price} for level ${level.price}`,
          strategy: this.name,
          pair, price, amount: this.config.basePositionSize
        };
      }
      
      // 3. Profit Target (Sell Price)
      if (price >= level.sellPrice) {
        return {
          action: 'sell',
          confidence: 0.95,
          reason: `Grid profit target hit at ${price} for level ${level.price}`,
          strategy: this.name,
          pair, price, amount: this.config.basePositionSize
        };
      }
    }
    return null;
  }

  shouldRebalance(pair, price, state) {
    const grids = this.grids.get(pair);
    if (!grids || grids.length === 0) return true;
    
    // Rebalance if price is way outside our current grid range
    const minGrid = Math.min(...grids.map(g => g.price));
    const maxGrid = Math.max(...grids.map(g => g.sellPrice));
    
    const range = maxGrid - minGrid;
    if (price < minGrid - range * 0.5 || price > maxGrid + range * 0.5) {
      return true;
    }
    
    // Rebalance if ATR changes significantly (e.g., 20% change in spacing)
    const atr = state.getATR(this.config.primaryTimeframe, 14);
    if (atr) {
      const currentSpacing = grids[1]?.price - grids[0]?.price;
      const newSpacing = atr * this.config.gridSpacingAtrMultiplier;
      if (currentSpacing && Math.abs(newSpacing - currentSpacing) / currentSpacing > 0.2) {
        return true;
      }
    }
    
    return false;
  }

  rebalanceGrid(pair, price, state) {
    const atr = state.getATR(this.config.primaryTimeframe, 14);
    const spacing = atr ? atr * this.config.gridSpacingAtrMultiplier : price * 0.01;
    
    const levels = [];
    const numLevels = this.config.gridLevels;
    
    // Center grid around current price, creating levels below
    for (let i = 1; i <= numLevels; i++) {
      const levelPrice = price - (i * spacing);
      levels.push({
        price: levelPrice,
        sellPrice: levelPrice + spacing,
        type: 'buy'
      });
    }
    
    // Sort levels from lowest (highest buy temptation) to highest (profit target)
    levels.sort((a, b) => a.price - b.price);
    
    this.grids.set(pair, levels);
    logger.info(`Grid rebalanced for ${pair} around ${price.toFixed(2)} with spacing ${spacing.toFixed(2)}. Total levels: ${levels.length}`);
  }

  recordTrade(trade) {
    // Update active levels tracking
    const pair = trade.pair;
    let active = this.activePositions.get(pair) || [];
    
    if (trade.side === 'buy') {
      active.push({ price: trade.gridLevel || trade.price, amount: trade.amount, entryTime: Date.now() });
    } else {
      // Find and remove the nearest matching buy level
      const index = active.findIndex(l => Math.abs(l.price - (trade.gridLevel || trade.price)) / l.price < 0.01);
      if (index !== -1) active.splice(index, 1);
    }
    
    this.activePositions.set(pair, active);
    this.trades.push(trade);
  }

  getPerformance() {
    return {
      name: this.name,
      totalSignals: this.signals.length,
      activeGrids: Array.from(this.activePositions.values()).reduce((sum, a) => sum + a.length, 0)
    };
  }

  reset() {
    this.indicatorStates.clear();
    this.grids.clear();
    this.activePositions.clear();
    this.signals = [];
    this.trades = [];
    logger.info('GridTradingStrategyV2 reset');
  }
}

module.exports = GridTradingStrategyV2;