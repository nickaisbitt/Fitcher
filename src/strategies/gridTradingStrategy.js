const logger = require('../utils/logger');

/**
 * GridTradingStrategy - Automated grid trading
 * Places buy/sell orders at fixed intervals around current price.
 * Auto-rebalances when price moves out of range.
 *
 * Grid range is derived from gridSpacing * gridLevels (no separate gridRange param).
 * Tracks filled buys so sell signals are only emitted when there is inventory (spot mode).
 * Enforces maxGrids on pending grid count.
 * Returns all filled levels per candle, not just the first.
 */
class GridTradingStrategy {
  constructor(config = {}) {
    this.config = {
      gridLevels: 10,        // Total number of grid levels (split evenly above/below center)
      gridSpacing: 0.5,      // Percentage between levels
      positionSize: 0.05,    // Fraction of balance per grid level
      maxGrids: 20,          // Max concurrent pending grids
      rebalanceThreshold: 0.8, // Rebalance when price reaches 80% of half-range from center
      ...config
    };

    this.name = 'Grid Trading';
    this.grids = [];
    this.centerPrice = null;
    this.lastRebalance = null;
    this.filledBuys = 0; // Net filled buy grids (for spot-mode sell limiting)
  }

  /**
   * Generate trading signal(s) for the current candle.
   * Returns a single signal object, or an array when multiple grid levels are
   * crossed in one candle.
   * @param {Object} marketData - Must contain at least { price }.
   */
  async generateSignal(marketData) {
    try {
      const { price } = marketData;

      // Initialize grid center on first call
      if (!this.centerPrice) {
        this.centerPrice = price;
        this.initializeGrids(price);
      }

      // Check if rebalancing is needed
      if (this.shouldRebalance(price)) {
        return this.rebalanceGrid(price);
      }

      // Check ALL filled levels (multiple can trigger per candle)
      const filledLevels = this.checkFilledLevels(price);
      if (filledLevels.length > 0) {
        const signals = filledLevels.map(grid => this.handleFilledLevel(grid, price));
        // Filter out hold signals (spot-mode blocks with no inventory)
        const actionable = signals.filter(s => s.action !== 'hold');
        if (actionable.length === 1) return actionable[0];
        if (actionable.length > 1) return actionable;
        // All were blocked — return the first hold reason
        return signals[0];
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
   * Initialize grid levels around center price.
   * Buy grids are placed below center, sell grids above.
   * @param {number} centerPrice
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
        amount: this.config.positionSize
      });
    }

    // Sort by price ascending
    this.grids.sort((a, b) => a.price - b.price);

    logger.info(`Grid initialized with ${this.grids.length} levels around ${centerPrice.toFixed(2)}`);
  }

  /**
   * Determine whether the grid should rebalance.
   *
   * Range is derived from spacing and level count:
   *   halfRange = halfLevels * spacing * centerPrice
   *
   * Trigger when price reaches rebalanceThreshold (e.g. 80%) of that half-range
   * measured outward from center.
   *
   * @param {number} currentPrice
   * @returns {boolean}
   */
  shouldRebalance(currentPrice) {
    if (!this.centerPrice) return false;

    const spacing = this.config.gridSpacing / 100;
    const halfLevels = Math.floor(this.config.gridLevels / 2);
    const halfRange = halfLevels * spacing * this.centerPrice;

    const upperLimit = this.centerPrice + halfRange * this.config.rebalanceThreshold;
    const lowerLimit = this.centerPrice - halfRange * this.config.rebalanceThreshold;

    if (currentPrice >= upperLimit || currentPrice <= lowerLimit) {
      // Don't rebalance more often than every 5 minutes
      if (this.lastRebalance && Date.now() - this.lastRebalance < 300000) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Rebalance grid to a new center price.
   * Cancels all pending grids and reinitializes around the new center.
   * @param {number} newCenterPrice
   */
  rebalanceGrid(newCenterPrice) {
    logger.info(`Rebalancing grid from ${this.centerPrice.toFixed(2)} to ${newCenterPrice.toFixed(2)}`);

    const pendingGrids = this.grids.filter(g => g.status === 'pending');

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
   * Check ALL pending grid levels that have been crossed by current price.
   * Returns an array of filled grids (may be empty).
   * @param {number} currentPrice
   * @returns {Object[]}
   */
  checkFilledLevels(currentPrice) {
    const filled = [];

    for (const grid of this.grids) {
      if (grid.status !== 'pending') continue;

      if (grid.side === 'buy' && currentPrice <= grid.price) {
        filled.push(grid);
      } else if (grid.side === 'sell' && currentPrice >= grid.price) {
        filled.push(grid);
      }
    }

    return filled;
  }

  /**
   * Handle a single filled grid level.
   *
   * Returns a signal whose action matches the filled grid's side:
   *   - buy grid filled  -> action: 'buy'
   *   - sell grid filled -> action: 'sell'
   *
   * An opposite-side grid is PLACED (for the future) at the next level,
   * subject to maxGrids enforcement and deduplication.
   *
   * Spot-mode sell limiting: sell signals are suppressed when filledBuys <= 0.
   *
   * @param {Object} filledGrid
   * @param {number} currentPrice
   * @returns {Object} signal
   */
  handleFilledLevel(filledGrid, currentPrice) {
    filledGrid.status = 'filled';
    filledGrid.filledAt = Date.now();
    filledGrid.filledPrice = currentPrice;

    // The signal action is the filled grid's own side
    const action = filledGrid.side;

    logger.info(`Grid level ${filledGrid.level} (${action}) filled at ${currentPrice.toFixed(2)}`);

    // Track net buys for spot-mode sell limiting
    if (action === 'buy') {
      this.filledBuys++;
    } else if (action === 'sell') {
      this.filledBuys = Math.max(0, this.filledBuys - 1);
    }

    // Place an opposite order at the next level (for the future)
    const oppositeSide = action === 'buy' ? 'sell' : 'buy';
    const nextLevel = action === 'buy' ? filledGrid.level + 1 : filledGrid.level - 1;
    const pendingCount = this.grids.filter(g => g.status === 'pending').length;

    if (pendingCount < this.config.maxGrids) {
      // Only create if no pending grid already exists at that level
      const alreadyExists = this.grids.some(
        g => g.level === nextLevel && g.status === 'pending'
      );

      if (!alreadyExists) {
        const spacing = this.config.gridSpacing / 100;
        this.grids.push({
          level: nextLevel,
          price: this.centerPrice * (1 + nextLevel * spacing),
          side: oppositeSide,
          status: 'pending',
          amount: this.config.positionSize
        });
      }
    }

    // Spot-mode: suppress sell when we have no inventory
    if (action === 'sell' && this.filledBuys <= 0) {
      return {
        action: 'hold',
        confidence: 0,
        reason: `No position to sell (spot mode) at level ${filledGrid.level}`
      };
    }

    return {
      action,
      confidence: 0.7,
      reason: `Grid ${action} at level ${filledGrid.level} (price ${currentPrice.toFixed(2)})`,
      price: currentPrice,
      amount: filledGrid.amount,
      gridLevel: filledGrid.level
    };
  }

  /**
   * Get grid statistics.
   */
  getGridStats() {
    const filled = this.grids.filter(g => g.status === 'filled').length;
    const pending = this.grids.filter(g => g.status === 'pending').length;

    return {
      centerPrice: this.centerPrice,
      totalLevels: this.grids.length,
      filledLevels: filled,
      pendingLevels: pending,
      filledBuys: this.filledBuys,
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
   * Get strategy configuration.
   */
  getConfig() {
    return {
      name: this.name,
      ...this.config
    };
  }

  /**
   * Update strategy parameters.
   * Always fully resets state so grids reinitialize on the next signal.
   * @param {Object} params
   */
  updateParams(params) {
    Object.assign(this.config, params);
    // Full reset — grids will reinitialize on next generateSignal call
    this.reset();
  }

  /**
   * Reset all strategy state.
   */
  reset() {
    this.grids = [];
    this.centerPrice = null;
    this.lastRebalance = null;
    this.filledBuys = 0;
  }
}

module.exports = GridTradingStrategy;
