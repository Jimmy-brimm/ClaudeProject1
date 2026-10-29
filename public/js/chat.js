/*
 * Chat box: sends the current design and the conversation to the small
 * backend (server/server.mjs), which calls the AI model with the API key it
 * keeps. If the model returns an updated design, the whole page updates and
 * the change can be undone. The key never reaches the browser.
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const HISTORY_SENT = 16; // recent messages sent along for context
  let available = false;
  let busy = false;
  let sessionCost = 0;

  function setStatus(html, off) {
    const el = $('#chat-status');
    el.innerHTML = html;
    el.classList.toggle('off', !!off);
  }

  async function checkServer() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('api/status', { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(res.status);
      const s = await res.json();
      if (s.chat) {
        available = true;
        setStatus(`Talk through changes and the sheet, diagram, numbers and 3D shape update. Each reply is a paid API call (model: <code>${s.model}</code>).`);
      } else {
        setStatus('The server is running but has no API key yet. Put <code>ANTHROPIC_API_KEY=…</code> in a <code>.env</code> file next to <code>package.json</code> and restart <code>npm start</code>.', true);
      }
    } catch {
      setStatus('Chat needs the small local server, which keeps the API key off this page. Run <code>npm start</code> (see the README) and open <code>http://localhost:3000</code>. Everything else on the page works without it.', true);
    }
    $('#chat-send').disabled = !available;
  }

  function renderLog() {
    const log = $('#chat-log');
    const history = window.App.chatHistory(window.App.projectId);
    if (!history.length) {
      log.innerHTML = `<li class="hint">Try: “Make the panel 30 W and add a hand crank as a backup”, or “What should I test first?”</li>`;
      return;
    }
    log.innerHTML = '';
    history.forEach((m, i) => {
      const li = document.createElement('li');
      li.className = `msg ${m.role}`;
      li.textContent = m.text;
      if (m.changed && m.changed.length) {
        const div = document.createElement('div');
        div.className = 'changed';
        div.innerHTML = `<span class="pill info">updated</span><span class="hint">${m.changed.join(', ')}</span>`;
        if (i === history.length - 1) {
          const undo = document.createElement('button');
          undo.type = 'button';
          undo.textContent = 'Undo';
          undo.addEventListener('click', () => {
            window.App.undo();
            m.changed = [];
            m.text += '\n(Change undone.)';
            window.App.saveChat();
            renderLog();
          });
          div.appendChild(undo);
        }
        li.appendChild(div);
      }
      log.appendChild(li);
    });
    log.scrollTop = log.scrollHeight;
  }

  async function send(text) {
    if (busy || !available || !text.trim()) return;
    const id = window.App.projectId;
    const history = window.App.chatHistory(id);
    const prior = history
      .filter((m) => m.role !== 'error')
      .slice(-HISTORY_SENT)
      .map((m) => ({ role: m.role, text: m.text }));
    history.push({ role: 'user', text: text.trim() });
    window.App.saveChat();
    renderLog();

    busy = true;
    $('#chat-send').disabled = true;
    const waiting = document.createElement('li');
    waiting.className = 'thinking';
    waiting.textContent = 'Thinking it through…';
    $('#chat-log').appendChild(waiting);

    try {
      const res = await fetch('api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: window.App.project, history: prior, message: text.trim() }),
      });
      const data = await res.json().catch(() => ({ error: `The server answered with status ${res.status}.` }));
      if (!res.ok || data.error) throw new Error(data.error || `Status ${res.status}`);

      let changed = [];
      // Only apply if the user is still on the same project.
      if (data.project && window.App.projectId === id) changed = window.App.applyFromChat(data.project);
      history.push({ role: 'assistant', text: data.reply || '(No reply text.)', changed });
      if (data.usage && Number.isFinite(data.usage.costUsd)) {
        sessionCost += data.usage.costUsd;
        $('#chat-cost').textContent = `≈ $${sessionCost.toFixed(3)} this session`;
      }
    } catch (err) {
      history.push({ role: 'error', text: `That did not go through: ${err.message}` });
    } finally {
      busy = false;
      $('#chat-send').disabled = !available;
      window.App.saveChat();
      if (window.App.projectId === id) renderLog();
    }
  }

  function setupMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const btn = $('#chat-mic');
    if (!SR) return;
    btn.hidden = false;
    let rec = null;
    btn.addEventListener('click', () => {
      if (rec) {
        rec.stop();
        return;
      }
      const input = $('#chat-input');
      const base = input.value ? input.value.replace(/\s*$/, ' ') : '';
      rec = new SR();
      rec.lang = navigator.language || 'en-GB';
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        let said = '';
        for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
        input.value = base + said;
      };
      const done = () => {
        rec = null;
        btn.textContent = 'Speak';
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('is-live');
      };
      rec.onend = done;
      rec.onerror = (e) => {
        done();
        window.App.toast(e.error === 'not-allowed' ? 'Microphone access was refused.' : `Voice input stopped: ${e.error}`);
      };
      try {
        rec.start();
        btn.textContent = 'Stop';
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('is-live');
      } catch {
        done();
      }
    });
  }

  window.Chat = {
    init() {
      checkServer();
      setupMic();
      $('#chat-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('#chat-input');
        const text = input.value;
        if (!text.trim() || !available || busy) return;
        input.value = '';
        send(text);
      });
      $('#chat-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault();
          $('#chat-form').requestSubmit();
        }
      });
      renderLog();
    },
    shown() {
      renderLog();
    },
    projectChanged() {
      renderLog();
    },
  };
})();
