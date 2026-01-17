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

# Create the HTML template with Fitcher branding
html_template = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Fitcher - AI-Powered Crypto Trading</title>
    <meta name="description" content="Modern Nordic-inspired AI trading bot with multi-exchange support">
    <meta name="theme-color" content="#0D1B2A">

    <!-- Favicon -->
    <link rel="icon" type="image/svg+xml" href="favicon.svg">

    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        nordic: {
                            dark: '#0D1B2A',
                            deep: '#1B2838',
                            blue: '#4A90B8',
                            pale: '#7FB3D3',
                            ice: '#B8D4E8',
                            frost: '#E8F4FC',
                            white: '#FFFFFF'
                        }
                    }
                }
            }
        }
    </script>

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
            background: linear-gradient(135deg, #0D1B2A 0%, #1B2838 50%, #0D1B2A 100%);
            min-height: 100vh;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        #root { min-height: 100vh; }

        /* Custom scrollbar - Nordic theme */
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #1B2838; }
        ::-webkit-scrollbar-thumb { background: #4A90B8; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #7FB3D3; }

        /* Animations */
        @keyframes pulse-glow {
            0%, 100% { box-shadow: 0 0 5px rgba(127, 179, 211, 0.5); }
            50% { box-shadow: 0 0 20px rgba(127, 179, 211, 0.8); }
        }
        .pulse-glow { animation: pulse-glow 2s infinite; }

        @keyframes slide-in {
            from { transform: translateX(-100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .slide-in { animation: slide-in 0.3s ease-out; }

        @keyframes frost-shimmer {
            0% { background-position: -200% center; }
            100% { background-position: 200% center; }
        }
        .frost-shimmer {
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
            background-size: 200% 100%;
            animation: frost-shimmer 3s infinite;
        }

        /* Loading spinner - Nordic blue */
        .loading-spinner {
            border: 3px solid rgba(127, 179, 211, 0.2);
            border-top: 3px solid #7FB3D3;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        /* Fitcher logo text */
        .fitcher-logo {
            font-weight: 700;
            font-size: 28px;
            background: linear-gradient(135deg, #FFFFFF 0%, #B8D4E8 50%, #7FB3D3 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            letter-spacing: -0.5px;
        }
    </style>
</head>
<body>
    <div id="root">
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; color: white;">
            <img src="logo.svg" alt="Fitcher" width="80" height="80" style="margin-bottom: 16px;">
            <div class="loading-spinner"></div>
            <p class="fitcher-logo" style="margin-top: 20px;">Fitcher</p>
            <p style="margin-top: 8px; font-size: 14px; color: #7FB3D3;">AI-Powered Trading</p>
            <p style="margin-top: 16px; font-size: 12px; color: #4A90B8;">Initializing...</p>
        </div>
    </div>

    <script type="text/babel">
        // Make React hooks available globally
        const { useState, useEffect, useCallback, useRef } = React;

        // ==================== FITCHER AI TRADING BOT ====================

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
