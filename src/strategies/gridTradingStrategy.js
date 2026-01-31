const logger = require('../utils/logger');

/**
 * GridTradingStrategy - Automated grid trading
 * Places buy/sell orders at fixed intervals around current price
 * Auto-rebalances when price moves out of range
 */
class GridTradingStrategy {
  constructor(config = {}) {
    this.config = {
      gridLevels: config.gridLevels || 10, // Number of grid levels
      gridSpacing: config.gridSpacing || 0.5, // Percentage between levels
      gridRange: config.gridRange || 5, // Total range percentage
      positionSize: config.positionSize || 0.05, // Size per grid level
      maxGrids: config.maxGrids || 5, // Max concurrent grids
      rebalanceThreshold: config.rebalanceThreshold || 0.8, // Rebalance when price at 80% of range
      ...config
    };
    
    this.name = 'Grid Trading';
    this.grids = []; // Active grid orders
    this.centerPrice = null;
    this.lastRebalance = null;
  }

  /**
   * Generate trading signal
   * @param {Object} marketData - Market data
   */
  async generateSignal(marketData) {
    try {
      const { price } = marketData;
      
      // Initialize grid center if not set
      if (!this.centerPrice) {
        this.centerPrice = price;
        this.initializeGrids(price);
      }
      
      // Check if rebalancing is needed
      if (this.shouldRebalance(price)) {
        return this.rebalanceGrid(price);
      }
      
      // Check for filled grid levels
      const filledLevel = this.checkFilledLevels(price);
      if (filledLevel) {
        return this.handleFilledLevel(filledLevel, price);
      }
      
      return {
        action: 'hold',
        confidence: 0,
        reason: 'Monitoring grid levels'
      };
      
    } catch (error) {
      logger.error('Grid trading strategy error:', error);
      return {
        action: 'hold',
        confidence: 0,
        reason: 'Strategy error'
      };
    }
  }

  /**
   * Initialize grid levels around center price
   * @param {number} centerPrice - Center price
   */
  initializeGrids(centerPrice) {
    this.grids = [];
    const spacing = this.config.gridSpacing / 100;
    const halfLevels = Math.floor(this.config.gridLevels / 2);
    
    for (let i = -halfLevels; i <= halfLevels; i++) {
      if (i === 0) continue; // Skip center
      
      const levelPrice = centerPrice * (1 + i * spacing);
      const side = i < 0 ? 'buy' : 'sell';
      
      this.grids.push({
        level: i,
        price: levelPrice,
        side,
        status: 'pending',
        amount: this.calculateGridSize()
      });
    }
    
    // Sort by price
    this.grids.sort((a, b) => a.price - b.price);
    
    logger.info(`Grid initialized with ${this.grids.length} levels around ${centerPrice.toFixed(2)}`);
  }

  /**
   * Check if grid should be rebalanced
   * @param {number} currentPrice - Current market price
   */
  shouldRebalance(currentPrice) {
    if (!this.centerPrice) return false;
    
    const range = this.config.gridRange / 100;
    const upperBound = this.centerPrice * (1 + range);
    const lowerBound = this.centerPrice * (1 - range);
    
    // Rebalance if price is near edge of grid
    if (currentPrice >= upperBound * this.config.rebalanceThreshold ||
        currentPrice <= lowerBound * this.config.rebalanceThreshold) {
      
      // Don't rebalance too frequently
      if (this.lastRebalance && Date.now() - this.lastRebalance < 300000) { // 5 min
        return false;
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Rebalance grid to new center price
   * @param {number} newCenterPrice - New center price
   */
  rebalanceGrid(newCenterPrice) {
    logger.info(`Rebalancing grid from ${this.centerPrice.toFixed(2)} to ${newCenterPrice.toFixed(2)}`);
    
    // Close all pending grid orders
    const pendingGrids = this.grids.filter(g => g.status === 'pending');
    
    // Reset and reinitialize
    this.centerPrice = newCenterPrice;
    this.lastRebalance = Date.now();
    this.initializeGrids(newCenterPrice);
    
    return {
      action: 'hold',
      confidence: 0.5,
      reason: `Grid rebalanced to ${newCenterPrice.toFixed(2)}`,
      rebalance: true,
      canceledGrids: pendingGrids.length
    };
  }

  /**
   * Check for filled grid levels
   * @param {number} currentPrice - Current price
   */
  checkFilledLevels(currentPrice) {
    for (const grid of this.grids) {
      if (grid.status !== 'pending') continue;
      
      // Check if price crossed grid level
      if (grid.side === 'buy' && currentPrice <= grid.price) {
        return grid;
      } else if (grid.side === 'sell' && currentPrice >= grid.price) {
        return grid;
      }
    }
    
    return null;
  }

  /**
   * Handle filled grid level
   * @param {Object} filledGrid - Filled grid level
   * @param {number} currentPrice - Current price
   */
  handleFilledLevel(filledGrid, currentPrice) {
    filledGrid.status = 'filled';
    filledGrid.filledAt = Date.now();
    filledGrid.filledPrice = currentPrice;
    
    logger.info(`Grid level ${filledGrid.level} filled at ${currentPrice.toFixed(2)}`);
    
    // Create opposite order at next level
    const oppositeSide = filledGrid.side === 'buy' ? 'sell' : 'buy';
    const nextLevel = filledGrid.side === 'buy' ? filledGrid.level + 1 : filledGrid.level - 1;
    
    // Find if there's already a grid at the next level
    const existingGrid = this.grids.find(g => g.level === nextLevel);
    
    if (existingGrid && existingGrid.status === 'pending') {
      // Use existing grid
      return {
        action: oppositeSide,
        confidence: 0.7,
        reason: `Grid level ${filledGrid.level} filled, placing ${oppositeSide} at level ${nextLevel}`,
        price: currentPrice,
        amount: filledGrid.amount,
        gridLevel: nextLevel,
        filledLevel: filledGrid.level
      };
    }
    
    // Create new grid level
    const spacing = this.config.gridSpacing / 100;
    const newPrice = this.centerPrice * (1 + nextLevel * spacing);
    
    this.grids.push({
      level: nextLevel,
      price: newPrice,
      side: oppositeSide,
      status: 'pending',
      amount: this.calculateGridSize()
    });
    
    return {
      action: oppositeSide,
      confidence: 0.7,
      reason: `Grid level ${filledGrid.level} filled, creating new ${oppositeSide} at level ${nextLevel}`,
      price: currentPrice,
      amount: filledGrid.amount,
      gridLevel: nextLevel,
      filledLevel: filledGrid.level
    };
  }

  /**
   * Calculate size for each grid level
   */
  calculateGridSize() {
    return this.config.positionSize;
  }

  /**
   * Get grid statistics
   */
  getGridStats() {
    const filled = this.grids.filter(g => g.status === 'filled').length;
    const pending = this.grids.filter(g => g.status === 'pending').length;
    
    return {
      centerPrice: this.centerPrice,
      totalLevels: this.grids.length,
      filledLevels: filled,
      pendingLevels: pending,
      lastRebalance: this.lastRebalance,
      grids: this.grids.map(g => ({
        level: g.level,
        price: g.price,
        side: g.side,
        status: g.status
      }))
    };
  }

  /**
   * Get strategy configuration
   */
  getConfig() {
    return {
      name: this.name,
      ...this.config
    };
  }

  /**
   * Update strategy parameters
   * @param {Object} params - New parameters
   */
  updateParams(params) {
    Object.assign(this.config, params);
    
    // Reinitialize if spacing or levels changed
    if (params.gridSpacing || params.gridLevels) {
      this.initializeGrids(this.centerPrice);
    }
    
    logger.info('Grid trading strategy parameters updated:', params);
  }

  /**
   * Reset strategy
   */
  reset() {
    this.grids = [];
    this.centerPrice = null;
    this.lastRebalance = null;
    logger.info('Grid trading strategy reset');
  }
}

module.exports = GridTradingStrategy;
