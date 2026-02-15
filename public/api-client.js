// Fitcher API Client - Connects frontend to backend API
// Tokens stored in-memory only (never localStorage). Refresh tokens use httpOnly cookies.
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000/api' 
  : '/api';

class FitcherAPI {
  constructor() {
    this.baseURL = API_BASE_URL;
    this.token = null;       // In-memory only, never persisted
    this._refreshing = null; // Prevents concurrent refresh attempts
  }

  // Set access token (memory only -- no localStorage)
  setToken(token) {
    this.token = token;
  }

  // Get in-memory access token
  getToken() {
    return this.token;
  }

  // Clear in-memory token
  clearToken() {
    this.token = null;
  }

  // Make authenticated request with auto-refresh on 401
  async request(endpoint, options = {}, _isRetry = false) {
    const url = `${this.baseURL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include' // Always send cookies (httpOnly refresh token)
    });

    // Check response.ok BEFORE parsing body
    if (!response.ok) {
      let errorData = {};
      try { errorData = await response.json(); } catch {}

      // Auto-refresh on token expiry (retry once to avoid infinite loops)
      if (response.status === 401 && errorData.code === 'TOKEN_EXPIRED' && !_isRetry) {
        const refreshed = await this._tryRefresh();
        if (refreshed) {
          return this.request(endpoint, options, true);
        }
      }

      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Attempt to refresh the access token using the httpOnly refresh cookie
  async _tryRefresh() {
    // Deduplicate concurrent refresh attempts
    if (this._refreshing) return this._refreshing;

    this._refreshing = (async () => {
      try {
        const response = await fetch(`${this.baseURL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include', // Browser sends httpOnly refresh cookie
          body: JSON.stringify({})
        });
        if (!response.ok) return false;
        const data = await response.json();
        if (data.success && data.data.accessToken) {
          this.setToken(data.data.accessToken);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        this._refreshing = null;
      }
    })();

    return this._refreshing;
  }

  // ==================== AUTHENTICATION ====================
  
  async signup(email, password, name) {
    const data = await this.request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name })
    });
    
    if (data.success && data.data.accessToken) {
      this.setToken(data.data.accessToken);
    }
    
    return data;
  }

  async login(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    
    if (data.success && data.data.accessToken) {
      this.setToken(data.data.accessToken);
    }
    
    return data;
  }

  async refreshToken() {
    // Public method -- delegates to the internal refresh flow
    const refreshed = await this._tryRefresh();
    if (!refreshed) {
      throw new Error('Token refresh failed');
    }
  }

  async logout() {
    try {
      await fetch(`${this.baseURL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include' // Server clears httpOnly cookies
      });
    } catch {
      // Best-effort; clear local state regardless
    }
    this.clearToken();
  }

  isAuthenticated() {
    return !!this.token;
  }

  // ==================== USER PROFILE ====================
  
  async getProfile() {
    return this.request('/profile');
  }

  async getApiKeys() {
    return this.request('/keys');
  }

  // ==================== MARKET DATA ====================
  
  async getPrice(pair, exchange = null) {
    const query = exchange ? `?exchange=${exchange}` : '';
    return this.request(`/market/price/${pair}${query}`);
  }

  async getAllPrices() {
    return this.request('/market/prices');
  }

  async getOrderBook(pair, exchange = null, depth = 10) {
    const query = exchange ? `?exchange=${exchange}&depth=${depth}` : `?depth=${depth}`;
    return this.request(`/market/orderbook/${pair}${query}`);
  }

  async getTrades(pair, exchange = null, limit = 50) {
    const query = exchange ? `?exchange=${exchange}&limit=${limit}` : `?limit=${limit}`;
    return this.request(`/market/trades/${pair}${query}`);
  }

  async getCandles(pair, timeframe = '1h', limit = 100) {
    return this.request(`/market/candles/${pair}?timeframe=${timeframe}&limit=${limit}`);
  }

  // ==================== TRADING ====================
  
  async createOrder(orderData) {
    return this.request('/trading/orders', {
      method: 'POST',
      body: JSON.stringify(orderData)
    });
  }

  async getOrders(status = null) {
    const query = status ? `?status=${status}` : '';
    return this.request(`/trading/orders${query}`);
  }

  async getOrder(orderId) {
    return this.request(`/trading/orders/${orderId}`);
  }

  async cancelOrder(orderId) {
    return this.request(`/trading/orders/${orderId}/cancel`, {
      method: 'POST'
    });
  }

  async getPositions() {
    return this.request('/trading/positions');
  }

  async getPortfolio() {
    return this.request('/trading/portfolio');
  }

  // ==================== STRATEGIES ====================
  
  async getStrategies() {
    return this.request('/trading/strategies');
  }

  async createStrategy(strategyData) {
    return this.request('/trading/strategies', {
      method: 'POST',
      body: JSON.stringify(strategyData)
    });
  }

  async updateStrategy(strategyId, strategyData) {
    return this.request(`/trading/strategies/${strategyId}`, {
      method: 'PUT',
      body: JSON.stringify(strategyData)
    });
  }

  async deleteStrategy(strategyId) {
    return this.request(`/trading/strategies/${strategyId}`, {
      method: 'DELETE'
    });
  }

  async activateStrategy(strategyId) {
    return this.request(`/trading/strategies/${strategyId}/activate`, {
      method: 'POST'
    });
  }

  async deactivateStrategy(strategyId) {
    return this.request(`/trading/strategies/${strategyId}/deactivate`, {
      method: 'POST'
    });
  }

  // ==================== TRADING RULES ====================
  
  async getTradingRules() {
    return this.request('/trading/rules');
  }

  async createTradingRule(ruleData) {
    return this.request('/trading/rules', {
      method: 'POST',
      body: JSON.stringify(ruleData)
    });
  }

  async updateTradingRule(ruleId, ruleData) {
    return this.request(`/trading/rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(ruleData)
    });
  }

  async deleteTradingRule(ruleId) {
    return this.request(`/trading/rules/${ruleId}`, {
      method: 'DELETE'
    });
  }

  // ==================== EXCHANGES ====================
  
  async getExchanges() {
    return this.request('/exchanges');
  }

  async connectExchange(exchange, apiKey, apiSecret) {
    return this.request('/exchanges/connect', {
      method: 'POST',
      body: JSON.stringify({ exchange, apiKey, apiSecret })
    });
  }

  async disconnectExchange(exchange) {
    return this.request(`/exchanges/${exchange}/disconnect`, {
      method: 'POST'
    });
  }

  async getExchangeBalance(exchange) {
    return this.request(`/exchanges/${exchange}/balance`);
  }
}

// Create singleton instance
const fitcherAPI = new FitcherAPI();

// Export for use in React components
if (typeof window !== 'undefined') {
  window.fitcherAPI = fitcherAPI;
}

// Also export as ES module
if (typeof module !== 'undefined' && module.exports) {
  module.exports = fitcherAPI;
}
