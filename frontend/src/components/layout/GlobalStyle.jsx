export default function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');

      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

      :root {
        --bg:       #f4f6f9;
        --surface:  #ffffff;
        --surface2: #f1f5f9;
        --border:   #e2e8f0;
        --border2:  #cbd5e1;
        --text:     #0f172a;
        --text2:    #475569;
        --text3:    #94a3b8;
        --accent:   #2563eb;
        --accent2:  #3b82f6;
        --green:    #16a34a;
        --red:      #dc2626;
        --yellow:   #b45309;
        --mono:     'DM Mono', 'JetBrains Mono', ui-monospace, monospace;
      }

      html, body, #root { height: 100%; }
      body {
        font-family: 'DM Sans', system-ui, sans-serif;
        background: var(--bg);
        color: var(--text);
        -webkit-font-smoothing: antialiased;
      }
      button { background: none; border: none; cursor: pointer; font-family: inherit; }
      input, textarea, select { font-family: inherit; background: var(--surface); color: var(--text); }
      a { text-decoration: none; color: inherit; }

      @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
      @keyframes fadeUp  { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: translateY(0) } }
      @keyframes pulse   { 0%,100% { opacity: 0.5 } 50% { opacity: 1 } }
      @keyframes spin    { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      .fade-up { animation: fadeUp 0.25s ease both; }

      ::-webkit-scrollbar { width: 5px; height: 5px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 3px; }

      select option { background: #fff; color: var(--text); }
    `}</style>
  )
}