const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// We are going to add a confirmation prompt to the "Close Position" button.
// This is the "ONE BIG UX improvement".

// Search for the Close Position button in public/index.html
const search = `                    <button
                      onClick={() => executeTrade('sell', selectedPair, 'Manual Close')}
                      className="w-full py-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium hover:bg-red-500/30 transition"
                    >
                      Close Position
                    </button>`;

const replace = `                    <button
                      onClick={() => {
                        if (window.confirm('Are you sure you want to close this position? This action cannot be undone.')) {
                          executeTrade('sell', selectedPair, 'Manual Close');
                        }
                      }}
                      className="w-full py-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium hover:bg-red-500/30 transition"
                    >
                      Close Position
                    </button>`;

if (html.includes(search)) {
  html = html.replace(search, replace);
  fs.writeFileSync('public/index.html', html);
  console.log("Successfully added confirmation modal to Close Position button");
} else {
  console.log("Could not find Close Position button to replace.");
}
