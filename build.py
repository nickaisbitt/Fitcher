#!/usr/bin/env python3
"""Build script to convert JSX to standalone HTML with React CDN"""

import re

# Read the JSX file
with open('kraken-trading-bot.jsx', 'r') as f:
    jsx_content = f.read()

# Remove the import statement
jsx_content = re.sub(r"^import React.*?;\n", "", jsx_content)

# Change 'export default function' to just 'function'
jsx_content = jsx_content.replace('export default function KrakenTradingBot', 'function KrakenTradingBot')

# Create the HTML template
html_template = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kraken AI Trading Bot - Ultimate Profit Maximizer</title>

    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>

    <!-- React 18 -->
    <script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
    <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>

    <!-- Babel for JSX -->
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>

    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 0;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
            min-height: 100vh;
        }
        #root { min-height: 100vh; }

        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #1e293b; }
        ::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #64748b; }

        /* Animations */
        @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 5px rgba(16, 185, 129, 0.5); }
            50% { box-shadow: 0 0 20px rgba(16, 185, 129, 0.8); }
        }
        .pulse-glow { animation: pulse-glow 2s infinite; }

        @keyframes slide-in {
            from { transform: translateX(-100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .slide-in { animation: slide-in 0.3s ease-out; }

        /* Loading spinner */
        .loading-spinner {
            border: 3px solid rgba(255,255,255,0.1);
            border-top: 3px solid #10b981;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div id="root">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: white;">
            <div class="loading-spinner"></div>
            <p style="margin-top: 20px; font-size: 18px; font-family: system-ui;">Loading Kraken AI Trading Bot...</p>
            <p style="margin-top: 10px; font-size: 14px; color: #94a3b8;">Initializing profit maximization modules...</p>
        </div>
    </div>

    <script type="text/babel">
        // Make React hooks available globally
        const { useState, useEffect, useCallback, useRef } = React;

        // ==================== KRAKEN AI TRADING BOT ====================

JSX_CONTENT_PLACEHOLDER

        // ==================== RENDER APP ====================
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(<KrakenTradingBot />);
    </script>
</body>
</html>'''

# Insert the JSX content
final_html = html_template.replace('JSX_CONTENT_PLACEHOLDER', jsx_content)

# Write the HTML file
with open('index.html', 'w') as f:
    f.write(final_html)

print("✅ Build complete! index.html created successfully.")
print(f"   Total size: {len(final_html):,} bytes")
print(f"   Lines: {final_html.count(chr(10)):,}")
