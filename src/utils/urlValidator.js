const { URL } = require('url');

const isSafeWebhookUrl = (urlStr) => {
  try {
    const parsedUrl = new URL(urlStr);

    // Only allow http and https protocols
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }

    // Prevent SSRF by blocking local IPs and internal hostnames
    const hostname = parsedUrl.hostname;

    // Check for localhost / loopback
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.startsWith('127.')) {
      return false;
    }

    // Check for local network / private IPs (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16)
    if (
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return false;
    }

    return true;
  } catch (err) {
    return false; // Invalid URL
  }
};

module.exports = { isSafeWebhookUrl };
