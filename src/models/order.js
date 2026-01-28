const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

class Order {
  constructor(params) {
    this.id = params.id || uuidv4();
    this.userId = params.userId;
    this.exchange = params.exchange;
    this.pair = params.pair;
    this.type = params.type; // market, limit, stop, stop_limit, oco
    this.side = params.side; // buy, sell
    this.amount = parseFloat(params.amount);
    this.price = params.price ? parseFloat(params.price) : null;
    this.stopPrice = params.stopPrice ? parseFloat(params.stopPrice) : null;
    this.timeInForce = params.timeInForce || 'GTC'; // GTC, IOC, FOK
    this.status = 'pending'; // pending, open, filled, partial, cancelled, rejected, expired
    this.filledAmount = 0;
    this.remainingAmount = this.amount;
    this.averagePrice = null;
    this.fee = 0;
    this.feeCurrency = params.pair ? params.pair.split('/')[1] : 'USD';
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.filledAt = null;
    this.cancelledAt = null;
    this.externalOrderId = null;
    this.trades = [];
    this.metadata = params.metadata || {};
    this.strategyId = params.strategyId || null;
    this.notes = params.notes || '';
  }

  // Calculate order value
  getOrderValue() {
    if (this.price) {
      return this.amount * this.price;
    }
    return null; // Market orders don't have fixed value until filled
  }

  // Calculate filled value
  getFilledValue() {
    if (this.averagePrice) {
      return this.filledAmount * this.averagePrice;
    }
    return 0;
  }

  // Calculate remaining value
  getRemainingValue() {
    if (this.price) {
      return this.remainingAmount * this.price;
    }
    return null;
  }

  // Update order status
  updateStatus(newStatus, updates = {}) {
    const validStatuses = ['pending', 'open', 'filled', 'partial', 'cancelled', 'rejected', 'expired'];
    
    if (!validStatuses.includes(newStatus)) {
      throw new Error(`Invalid order status: ${newStatus}`);
    }

    this.status = newStatus;
    this.updatedAt = new Date();

    // Update additional fields
    if (updates.filledAmount !== undefined) {
      this.filledAmount = parseFloat(updates.filledAmount);
      this.remainingAmount = this.amount - this.filledAmount;
    }

    if (updates.averagePrice !== undefined) {
      this.averagePrice = parseFloat(updates.averagePrice);
    }

    if (updates.fee !== undefined) {
      this.fee = parseFloat(updates.fee);
    }

    if (updates.externalOrderId !== undefined) {
      this.externalOrderId = updates.externalOrderId;
    }

    // Set timestamps based on status
    if (newStatus === 'filled' || newStatus === 'partial') {
      this.filledAt = this.filledAt || new Date();
    }

    if (newStatus === 'cancelled') {
      this.cancelledAt = new Date();
    }

    logger.info(`Order ${this.id} status updated to ${newStatus}`, {
      orderId: this.id,
      userId: this.userId,
      status: newStatus,
      filledAmount: this.filledAmount,
      remainingAmount: this.remainingAmount
    });
  }

  // Add trade to order
  addTrade(trade) {
    this.trades.push({
      tradeId: trade.tradeId || uuidv4(),
      price: parseFloat(trade.price),
      amount: parseFloat(trade.amount),
      fee: parseFloat(trade.fee) || 0,
      timestamp: trade.timestamp || new Date(),
      side: trade.side || this.side
    });

    // Recalculate filled amount and average price
    const totalFilled = this.trades.reduce((sum, t) => sum + t.amount, 0);
    const totalValue = this.trades.reduce((sum, t) => sum + (t.price * t.amount), 0);
    const totalFee = this.trades.reduce((sum, t) => sum + t.fee, 0);

    this.filledAmount = totalFilled;
    this.remainingAmount = this.amount - totalFilled;
    this.averagePrice = totalFilled > 0 ? totalValue / totalFilled : null;
    this.fee = totalFee;

    // Update status based on fill
    if (this.remainingAmount <= 0) {
      this.updateStatus('filled');
    } else if (this.filledAmount > 0) {
      this.updateStatus('partial');
    }
  }

  // Check if order is active
  isActive() {
    return ['pending', 'open', 'partial'].includes(this.status);
  }

  // Check if order can be cancelled
  canCancel() {
    return ['pending', 'open', 'partial'].includes(this.status);
  }

  // Get order summary
  getSummary() {
    return {
      id: this.id,
      userId: this.userId,
      exchange: this.exchange,
      pair: this.pair,
      type: this.type,
      side: this.side,
      amount: this.amount,
      price: this.price,
      stopPrice: this.stopPrice,
      status: this.status,
      filledAmount: this.filledAmount,
      remainingAmount: this.remainingAmount,
      averagePrice: this.averagePrice,
      fee: this.fee,
      feeCurrency: this.feeCurrency,
      orderValue: this.getOrderValue(),
      filledValue: this.getFilledValue(),
      timeInForce: this.timeInForce,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      filledAt: this.filledAt,
      externalOrderId: this.externalOrderId,
      tradeCount: this.trades.length,
      strategyId: this.strategyId,
      notes: this.notes
    };
  }

  // Convert to JSON for storage
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      exchange: this.exchange,
      pair: this.pair,
      type: this.type,
      side: this.side,
      amount: this.amount,
      price: this.price,
      stopPrice: this.stopPrice,
      timeInForce: this.timeInForce,
      status: this.status,
      filledAmount: this.filledAmount,
      remainingAmount: this.remainingAmount,
      averagePrice: this.averagePrice,
      fee: this.fee,
      feeCurrency: this.feeCurrency,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      filledAt: this.filledAt,
      cancelledAt: this.cancelledAt,
      externalOrderId: this.externalOrderId,
      trades: this.trades,
      metadata: this.metadata,
      strategyId: this.strategyId,
      notes: this.notes
    };
  }

  // Create Order from JSON
  static fromJSON(json) {
    const order = new Order({
      id: json.id,
      userId: json.userId,
      exchange: json.exchange,
      pair: json.pair,
      type: json.type,
      side: json.side,
      amount: json.amount,
      price: json.price,
      stopPrice: json.stopPrice,
      timeInForce: json.timeInForce,
      metadata: json.metadata,
      strategyId: json.strategyId,
      notes: json.notes
    });

    // Restore state
    order.status = json.status;
    order.filledAmount = json.filledAmount;
    order.remainingAmount = json.remainingAmount;
    order.averagePrice = json.averagePrice;
    order.fee = json.fee;
    order.feeCurrency = json.feeCurrency;
    order.createdAt = new Date(json.createdAt);
    order.updatedAt = new Date(json.updatedAt);
    order.filledAt = json.filledAt ? new Date(json.filledAt) : null;
    order.cancelledAt = json.cancelledAt ? new Date(json.cancelledAt) : null;
    order.externalOrderId = json.externalOrderId;
    order.trades = json.trades || [];

    return order;
  }
}

module.exports = Order;