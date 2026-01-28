const logger = require('../utils/logger');
const Order = require('../models/order');

class OrderValidator {
  constructor(exchangeLimits = {}) {
    this.exchangeLimits = exchangeLimits;
    this.defaultLimits = {
      minOrderAmount: 0.0001,
      maxOrderAmount: 1000,
      minOrderValue: 10, // USD
      maxOrderValue: 100000, // USD
      pricePrecision: 8,
      amountPrecision: 8
    };
  }

  // Validate complete order
  validate(order) {
    const errors = [];

    // Required fields
    if (!order.userId) {
      errors.push('User ID is required');
    }

    if (!order.exchange) {
      errors.push('Exchange is required');
    }

    if (!order.pair) {
      errors.push('Trading pair is required');
    }

    if (!order.type) {
      errors.push('Order type is required');
    }

    if (!order.side) {
      errors.push('Order side is required');
    }

    if (order.amount === undefined || order.amount === null) {
      errors.push('Order amount is required');
    }

    // Validate order type
    const validTypes = ['market', 'limit', 'stop', 'stop_limit', 'oco'];
    if (order.type && !validTypes.includes(order.type.toLowerCase())) {
      errors.push(`Invalid order type: ${order.type}. Must be one of: ${validTypes.join(', ')}`);
    }

    // Validate order side
    const validSides = ['buy', 'sell'];
    if (order.side && !validSides.includes(order.side.toLowerCase())) {
      errors.push(`Invalid order side: ${order.side}. Must be one of: ${validSides.join(', ')}`);
    }

    // Validate amount
    if (order.amount !== undefined && order.amount !== null) {
      const amountValidation = this.validateAmount(order.amount, order.pair, order.exchange);
      if (!amountValidation.valid) {
        errors.push(amountValidation.error);
      }
    }

    // Validate price for limit orders
    if (['limit', 'stop_limit', 'oco'].includes(order.type?.toLowerCase())) {
      if (order.price === undefined || order.price === null) {
        errors.push('Price is required for limit orders');
      } else {
        const priceValidation = this.validatePrice(order.price, order.pair, order.exchange);
        if (!priceValidation.valid) {
          errors.push(priceValidation.error);
        }
      }
    }

    // Validate stop price for stop orders
    if (['stop', 'stop_limit', 'oco'].includes(order.type?.toLowerCase())) {
      if (order.stopPrice === undefined || order.stopPrice === null) {
        errors.push('Stop price is required for stop orders');
      } else {
        const stopPriceValidation = this.validatePrice(order.stopPrice, order.pair, order.exchange);
        if (!stopPriceValidation.valid) {
          errors.push(`Stop price: ${stopPriceValidation.error}`);
        }
      }

      // Validate stop price logic
      if (order.price && order.stopPrice) {
        const stopLogicValidation = this.validateStopLogic(order);
        if (!stopLogicValidation.valid) {
          errors.push(stopLogicValidation.error);
        }
      }
    }

    // Validate time in force
    if (order.timeInForce) {
      const validTimeInForce = ['GTC', 'IOC', 'FOK'];
      if (!validTimeInForce.includes(order.timeInForce.toUpperCase())) {
        errors.push(`Invalid time in force: ${order.timeInForce}. Must be one of: ${validTimeInForce.join(', ')}`);
      }
    }

    // Validate trading pair format
    if (order.pair) {
      const pairValidation = this.validatePairFormat(order.pair);
      if (!pairValidation.valid) {
        errors.push(pairValidation.error);
      }
    }

    // Validate order value
    if (order.amount && order.price) {
      const valueValidation = this.validateOrderValue(order.amount, order.price, order.exchange);
      if (!valueValidation.valid) {
        errors.push(valueValidation.error);
      }
    }

    // Check if user has sufficient balance (mock validation)
    if (order.side && order.amount && order.price) {
      const balanceValidation = this.validateSufficientBalance(order);
      if (!balanceValidation.valid) {
        errors.push(balanceValidation.error);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: this.getWarnings(order)
    };
  }

  // Validate order amount
  validateAmount(amount, pair, exchange) {
    const limits = this.getExchangeLimits(exchange);

    if (typeof amount !== 'number' || isNaN(amount)) {
      return { valid: false, error: 'Amount must be a valid number' };
    }

    if (amount <= 0) {
      return { valid: false, error: 'Amount must be greater than 0' };
    }

    if (amount < limits.minOrderAmount) {
      return { valid: false, error: `Amount must be at least ${limits.minOrderAmount}` };
    }

    if (amount > limits.maxOrderAmount) {
      return { valid: false, error: `Amount cannot exceed ${limits.maxOrderAmount}` };
    }

    // Check precision
    const amountStr = amount.toString();
    const decimalPlaces = amountStr.includes('.') ? amountStr.split('.')[1].length : 0;
    
    if (decimalPlaces > limits.amountPrecision) {
      return { 
        valid: false, 
        error: `Amount precision cannot exceed ${limits.amountPrecision} decimal places` 
      };
    }

    return { valid: true };
  }

  // Validate order price
  validatePrice(price, pair, exchange) {
    const limits = this.getExchangeLimits(exchange);

    if (typeof price !== 'number' || isNaN(price)) {
      return { valid: false, error: 'Price must be a valid number' };
    }

    if (price <= 0) {
      return { valid: false, error: 'Price must be greater than 0' };
    }

    // Check precision
    const priceStr = price.toString();
    const decimalPlaces = priceStr.includes('.') ? priceStr.split('.')[1].length : 0;
    
    if (decimalPlaces > limits.pricePrecision) {
      return { 
        valid: false, 
        error: `Price precision cannot exceed ${limits.pricePrecision} decimal places` 
      };
    }

    return { valid: true };
  }

  // Validate stop price logic
  validateStopLogic(order) {
    const { side, price, stopPrice } = order;

    if (side.toLowerCase() === 'buy') {
      // For buy orders: stop price should be >= limit price
      if (stopPrice < price) {
        return {
          valid: false,
          error: 'For buy stop-limit orders, stop price must be greater than or equal to limit price'
        };
      }
    } else if (side.toLowerCase() === 'sell') {
      // For sell orders: stop price should be <= limit price
      if (stopPrice > price) {
        return {
          valid: false,
          error: 'For sell stop-limit orders, stop price must be less than or equal to limit price'
        };
      }
    }

    return { valid: true };
  }

  // Validate trading pair format
  validatePairFormat(pair) {
    // Basic pair format validation (e.g., BTC/USD, ETH-USD)
    const pairRegex = /^[A-Z]{2,10}[\/\-][A-Z]{2,10}$/i;
    
    if (!pairRegex.test(pair)) {
      return {
        valid: false,
        error: 'Invalid pair format. Expected format: BASE/QUOTE or BASE-QUOTE (e.g., BTC/USD)'
      };
    }

    return { valid: true };
  }

  // Validate order value
  validateOrderValue(amount, price, exchange) {
    const limits = this.getExchangeLimits(exchange);
    const orderValue = amount * price;

    if (orderValue < limits.minOrderValue) {
      return {
        valid: false,
        error: `Order value ($${orderValue.toFixed(2)}) must be at least $${limits.minOrderValue}`
      };
    }

    if (orderValue > limits.maxOrderValue) {
      return {
        valid: false,
        error: `Order value ($${orderValue.toFixed(2)}) cannot exceed $${limits.maxOrderValue}`
      };
    }

    return { valid: true };
  }

  // Validate sufficient balance (mock implementation)
  validateSufficientBalance(order) {
    // In production, this would check actual user balance
    // For now, always return valid
    return { valid: true };
  }

  // Get exchange-specific limits
  getExchangeLimits(exchange) {
    return this.exchangeLimits[exchange?.toLowerCase()] || this.defaultLimits;
  }

  // Get warnings for order
  getWarnings(order) {
    const warnings = [];

    // Warning for large orders
    if (order.amount && order.price) {
      const orderValue = order.amount * order.price;
      if (orderValue > 50000) {
        warnings.push(`Large order value: $${orderValue.toFixed(2)}. Consider splitting into smaller orders.`);
      }
    }

    // Warning for market orders
    if (order.type?.toLowerCase() === 'market') {
      warnings.push('Market orders execute immediately at the best available price. Slippage may occur.');
    }

    // Warning for stop orders without limit price
    if (order.type?.toLowerCase() === 'stop' && !order.price) {
      warnings.push('Stop orders without a limit price may execute at unfavorable prices during high volatility.');
    }

    return warnings;
  }

  // Validate order update
  validateUpdate(order, updates) {
    const errors = [];

    // Check if order can be updated
    if (!['pending', 'open', 'partial'].includes(order.status)) {
      return {
        valid: false,
        errors: [`Cannot update order with status: ${order.status}`]
      };
    }

    // Validate price update
    if (updates.price !== undefined) {
      const priceValidation = this.validatePrice(updates.price, order.pair, order.exchange);
      if (!priceValidation.valid) {
        errors.push(priceValidation.error);
      }
    }

    // Validate amount update
    if (updates.amount !== undefined) {
      // Can only reduce amount, not increase
      if (updates.amount > order.amount) {
        errors.push('Cannot increase order amount. Cancel and create a new order instead.');
      }

      const amountValidation = this.validateAmount(updates.amount, order.pair, order.exchange);
      if (!amountValidation.valid) {
        errors.push(amountValidation.error);
      }

      // Check if new amount is less than filled amount
      if (updates.amount < order.filledAmount) {
        errors.push(`New amount (${updates.amount}) cannot be less than filled amount (${order.filledAmount})`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }
}

module.exports = OrderValidator;