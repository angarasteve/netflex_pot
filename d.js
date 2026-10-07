
const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const os = require('os');
const crypto = require('crypto');

// Robust TelegramBot constructor resolution with fallback built-in client for Node v24+
let TelegramBot;
try {
  const mod = require('node-telegram-bot-api');
  if (typeof mod === 'function') {
    TelegramBot = mod;
  } else if (mod && typeof mod.TelegramBot === 'function') {
    TelegramBot = mod.TelegramBot;
  } else if (mod && typeof mod.default === 'function') {
    TelegramBot = mod.default;
  } else if (mod && mod.default && typeof mod.default.TelegramBot === 'function') {
    TelegramBot = mod.default.TelegramBot;
  }
} catch (e) {
  console.warn('[System Notice] node-telegram-bot-api require warning:', e.message);
}

if (typeof TelegramBot !== 'function') {
  console.log('[System Engine] Activating built-in Telegram API Engine fallback...');
  class BuiltinTelegramBot extends EventEmitter {
    constructor(token, options = {}) {
      super();
      this.token = token;
      this.options = options;
      this.baseUrl = `https://api.telegram.org/bot${token}`;
      this.offset = 0;
      this.isPolling = false;
      this.textHandlers = [];

      if (options.polling) {
        setImmediate(() => this.startPolling());
      }
    }

    onText(regexp, callback) {
      this.textHandlers.push({ regexp, callback });
    }

    async sendMessage(chatId, text, options = {}) {
      try {
        const payload = {
          chat_id: chatId,
          text: text,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        };
        const res = await axios.post(`${this.baseUrl}/sendMessage`, payload, { timeout: 15000 });
        return res.data.result;
      } catch (err) {
        if (err.code !== 'ECONNABORTED' && err.code !== 'ECONNRESET') {
          console.error('[Bot Engine Error] sendMessage failed:', err.response?.data || err.message);
        }
        throw err;
      }
    }

    async editMessageText(text, options = {}) {
      try {
        const payload = {
          chat_id: options.chat_id,
          message_id: options.message_id,
          text: text,
          parse_mode: options.parse_mode,
          reply_markup: options.reply_markup
        };
        const res = await axios.post(`${this.baseUrl}/editMessageText`, payload, { timeout: 15000 });
        return res.data.result;
      } catch (err) {
        const errDesc = err.response?.data?.description || err.message || '';
        const isIgnorable = 
          err.code === 'ECONNABORTED' || 
          err.code === 'ECONNRESET' || 
          err.code === 'ETIMEDOUT' ||
          errDesc.includes('message is not modified') ||
          errDesc.includes('message to edit not found');

        if (!isIgnorable) {
          console.warn('[Bot Engine Notice] editMessageText non-critical notice:', errDesc);
        }
      }
    }

    async answerCallbackQuery(callbackQueryId, options = {}) {
      try {
        const payload = {
          callback_query_id: callbackQueryId,
          text: typeof options === 'string' ? options : (options.text || ''),
          show_alert: options.show_alert || false
        };
        await axios.post(`${this.baseUrl}/answerCallbackQuery`, payload, { timeout: 10000 });
      } catch (err) {
        // Silently handle non-critical callback answer timeouts
      }
    }

    async sendDocument(chatId, buffer, options = {}, fileOptions = {}) {
      try {
        const filename = fileOptions.filename || 'netflix_hits_export.txt';
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        let body = '';
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
        if (options.caption) {
          body += `--${boundary}\r\n`;
          body += `Content-Disposition: form-data; name="caption"\r\n\r\n${options.caption}\r\n`;
        }
        if (options.parse_mode) {
          body += `--${boundary}\r\n`;
          body += `Content-Disposition: form-data; name="parse_mode"\r\n\r\n${options.parse_mode}\r\n`;
        }
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n`;
        body += `Content-Type: text/plain\r\n\r\n`;

        const headerBuf = Buffer.from(body, 'utf-8');
        const footerBuf = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
        const payloadBuf = Buffer.concat([headerBuf, buffer, footerBuf]);

        const res = await axios.post(`${this.baseUrl}/sendDocument`, payloadBuf, {
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`
          }
        });
        return res.data.result;
      } catch (err) {
        console.error('[Bot Engine Error] sendDocument failed:', err.response?.data || err.message);
        throw err;
      }
    }

    async getFileLink(fileId) {
      const res = await axios.get(`${this.baseUrl}/getFile`, { params: { file_id: fileId } });
      const filePath = res.data.result.file_path;
      return `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    }

    async startPolling() {
      if (this.isPolling) return;
      this.isPolling = true;
      console.log('[Built-in Engine] Polling started successfully...');

      while (this.isPolling) {
        try {
          const res = await axios.get(`${this.baseUrl}/getUpdates`, {
            params: { offset: this.offset, timeout: 20 },
            timeout: 30000
          });

          if (res.data && res.data.ok && Array.isArray(res.data.result)) {
            for (const update of res.data.result) {
              this.offset = update.update_id + 1;
              this.handleUpdate(update);
            }
          }
        } catch (err) {
          if (err.code !== 'ECONNABORTED') {
            console.error('[Built-in Engine Polling Error]', err.message);
          }
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }

    handleUpdate(update) {
      if (update.message) {
        const msg = update.message;
        if (msg.text) {
          for (const handler of this.textHandlers) {
            const match = msg.text.match(handler.regexp);
            if (match) handler.callback(msg, match);
          }
          this.emit('text', msg);
        }
        if (msg.document) {
          this.emit('document', msg);
        }
      }
      if (update.callback_query) {
        this.emit('callback_query', update.callback_query);
      }
    }
  }

  TelegramBot = BuiltinTelegramBot;
}

let nativeDb = null;
let sqliteEngineMode = 'in_memory_fallback';

// Try initializing Node.js built-in node:sqlite module
try {
  const { DatabaseSync } = require('node:sqlite');
  nativeDb = new DatabaseSync('./netflix_hits_session.db');
  sqliteEngineMode = 'native_node_sqlite';
  console.log('[SQLite Engine] Native node:sqlite database initialized successfully.');
} catch (e) {
  console.warn('[SQLite Engine Notice] Built-in node:sqlite unavailable, using memory fallback engine.');
}

// In-Memory SQLite Fallback Store with identical API methods
class MemorySqliteStore {
  constructor() {
    this.hits = new Map();
  }

  exec(query) {
    // No-op for CREATE TABLE
  }

  insertHit(hitData) {
    this.hits.set(hitData.id, hitData);
  }

  getHitsBySession(sessionId) {
    const now = Date.now();
    const results = [];
    for (const h of this.hits.values()) {
      if (h.session_id === sessionId && h.expires_at > now) {
        results.push(h);
      }
    }
    return results;
  }

  getAllActiveHits() {
    const now = Date.now();
    const results = [];
    for (const h of this.hits.values()) {
      if (h.expires_at > now) {
        results.push(h);
      }
    }
    return results;
  }

  purgeExpired() {
    const now = Date.now();
    let count = 0;
    for (const [id, h] of this.hits.entries()) {
      if (h.expires_at <= now) {
        this.hits.delete(id);
        count++;
      }
    }
    return count;
  }
}

const memoryDb = new MemorySqliteStore();

if (sqliteEngineMode === 'native_node_sqlite' && nativeDb) {
  nativeDb.exec(`
    CREATE TABLE IF NOT EXISTS session_hits (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      hit_number INTEGER,
      email TEXT,
      country TEXT,
      plan TEXT,
      price TEXT,
      member_since TEXT,
      next_billing TEXT,
      payment TEXT,
      phone TEXT,
      quality TEXT,
      streams TEXT,
      hold_status TEXT,
      extra_member TEXT,
      profiles TEXT,
      cookie TEXT,
      phone_login TEXT,
      pc_login TEXT,
      login_link TEXT,
      created_at INTEGER,
      expires_at INTEGER
    )
  `);
}

/**
 * SQLite Store Access Interface
 */
const SqliteDatabase = {
  saveHit(hitData) {
    if (sqliteEngineMode === 'native_node_sqlite' && nativeDb) {
      try {
        const stmt = nativeDb.prepare(`
          INSERT INTO session_hits (
            id, session_id, hit_number, email, country, plan, price, member_since,
            next_billing, payment, phone, quality, streams, hold_status, extra_member,
            profiles, cookie, phone_login, pc_login, login_link, created_at, expires_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
          hitData.id, hitData.session_id, hitData.hit_number, hitData.email, hitData.country,
          hitData.plan, hitData.price, hitData.member_since, hitData.next_billing, hitData.payment,
          hitData.phone, hitData.quality, hitData.streams, hitData.hold_status, hitData.extra_member,
          hitData.profiles, hitData.cookie, hitData.phone_login, hitData.pc_login, hitData.login_link,
          hitData.created_at, hitData.expires_at
        );
      } catch (err) {
        console.error('[SQLite Insert Error]', err.message);
      }
    } else {
      memoryDb.insertHit(hitData);
    }
  },

  getHitsBySession(sessionId) {
    if (sqliteEngineMode === 'native_node_sqlite' && nativeDb) {
      try {
        const now = Date.now();
        const stmt = nativeDb.prepare(`
          SELECT * FROM session_hits WHERE session_id = ? AND expires_at > ?
        `);
        return stmt.all(sessionId, now);
      } catch (err) {
        console.error('[SQLite Query Error]', err.message);
        return [];
      }
    } else {
      return memoryDb.getHitsBySession(sessionId);
    }
  },

  getAllActiveHits() {
    if (sqliteEngineMode === 'native_node_sqlite' && nativeDb) {
      try {
        const now = Date.now();
        const stmt = nativeDb.prepare(`
          SELECT * FROM session_hits WHERE expires_at > ?
        `);
        return stmt.all(now);
      } catch (err) {
        console.error('[SQLite Query Error]', err.message);
        return [];
      }
    } else {
      return memoryDb.getAllActiveHits();
    }
  },

  purgeExpiredRecords() {
    const now = Date.now();
    let purgedCount = 0;
    if (sqliteEngineMode === 'native_node_sqlite' && nativeDb) {
      try {
        const stmt = nativeDb.prepare(`DELETE FROM session_hits WHERE expires_at <= ?`);
        const result = stmt.run(now);
        purgedCount = result.changes || 0;
      } catch (err) {
        console.error('[SQLite Purge Error]', err.message);
      }
    } else {
      purgedCount = memoryDb.purgeExpired();
    }
    return purgedCount;
  }
};

// Automatic 1-hour SQLite DB record expiration & cleanup worker (runs every 60 seconds)
setInterval(() => {
  const cleaned = SqliteDatabase.purgeExpiredRecords();
  if (cleaned > 0) {
    console.log(`[SQLite TTL Worker] Auto-purged ${cleaned} expired hit records older than 1 hour.`);
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8902637301:AAFQfeaLo0jOtcrKTFVWv0oSxu2k2pWA5WQ';
let HOST_URL = process.env.APP_URL || process.env.SERVER_URL || `http://localhost:${PORT}`;
const ALLOWED_USERS = process.env.ALLOWED_USERS ? process.env.ALLOWED_USERS.split(',').map(s => s.trim()) : null;

function getCountryFlag(countryCode) {
  if (!countryCode || countryCode === 'N/A' || countryCode.length !== 2) return '🌐';
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Storage stats tracker
const botStats = {
  startTime: new Date(),
  totalParsedFiles: 0,
  totalHitsProcessed: 0,
  totalPingsSent: 0,
  lastPingTime: null,
  countryBreakdown: {},
  planBreakdown: {}
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (!process.env.APP_URL && !process.env.SERVER_URL && req.get('host')) {
    HOST_URL = `${req.protocol}://${req.get('host')}`;
  }
  next();
});

app.get('/', (req, res) => {
  const uptimeMs = Date.now() - botStats.startTime.getTime();
  const uptimeHours = (uptimeMs / (1000 * 60 * 60)).toFixed(2);
  const freeMem = (os.freemem() / 1024 / 1024).toFixed(0);
  const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0);

  const activeSqliteHits = SqliteDatabase.getAllActiveHits();

  const countryLabels = JSON.stringify(Object.keys(botStats.countryBreakdown).slice(0, 7));
  const countryData = JSON.stringify(Object.values(botStats.countryBreakdown).slice(0, 7));
  const planLabels = JSON.stringify(Object.keys(botStats.planBreakdown).slice(0, 5));
  const planData = JSON.stringify(Object.values(botStats.planBreakdown).slice(0, 5));

  const recentRowsHtml = activeSqliteHits.slice(-10).reverse().map((h) => `
    <tr class="border-b border-slate-800/80 hover:bg-slate-800/50 transition-colors text-xs">
      <td class="py-2.5 px-3 font-mono text-red-400 font-bold">#${h.hit_number}</td>
      <td class="py-2.5 px-3 font-mono text-slate-200">${h.email}</td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded bg-slate-800 text-sky-400 font-bold">${getCountryFlag(h.country)} ${h.country}</span></td>
      <td class="py-2.5 px-3 text-slate-300">${h.plan}</td>
      <td class="py-2.5 px-3 text-emerald-400 font-semibold">${h.price}</td>
      <td class="py-2.5 px-3 text-amber-400 font-mono text-[11px]">${Math.max(0, Math.round((h.expires_at - Date.now()) / 60000))}m left</td>
    </tr>
  `).join('') || '<tr><td colspan="6" class="text-center py-6 text-slate-500 text-xs">No active SQLite hit records found in the 1-hour storage window. Send a file to Telegram!</td></tr>';

  const htmlResponse = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Netflix Log Engine — Cyber Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
    <style>
      body { background-color: #070a12; color: #f8fafc; font-family: 'Inter', system-ui, sans-serif; }
      .glow-box { box-shadow: 0 0 35px rgba(239, 68, 68, 0.15); }
      .custom-scroll::-webkit-scrollbar { width: 5px; height: 5px; }
      .custom-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
    </style>
  </head>
  <body class="min-h-screen p-4 md:p-8 flex justify-center items-start">
    <div class="max-w-6xl w-full bg-slate-900/90 backdrop-blur-2xl rounded-2xl p-6 md:p-8 border border-slate-800/80 glow-box my-4">
      
      <!-- Top Header -->
      <div class="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-slate-800/80 pb-6 mb-6 gap-4">
        <div class="flex items-center gap-4">
          <div class="p-3.5 bg-gradient-to-br from-red-600 to-red-800 text-white rounded-xl shadow-lg shadow-red-900/40 text-3xl">
            <i class="fa-solid fa-database"></i>
          </div>
          <div>
            <h1 class="text-2xl md:text-3xl font-extrabold text-white tracking-wide">Netflix Log Engine v3.0</h1>
            <p class="text-xs text-slate-400 mt-1">SQLite 1-Hour Session Store • Telegram Automation • Interactive Detections</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            SQLITE DB ACTIVE
          </span>
        </div>
      </div>

      <!-- Stat Cards -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div class="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80">
          <p class="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Server Uptime</p>
          <p class="text-2xl font-black text-white mt-1 font-mono">${uptimeHours} <span class="text-xs text-slate-500">hrs</span></p>
        </div>
        <div class="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80">
          <p class="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Active SQLite Hits</p>
          <p class="text-2xl font-black text-amber-400 mt-1 font-mono">${activeSqliteHits.length} <span class="text-xs text-slate-500">(1-hr TTL)</span></p>
        </div>
        <div class="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80">
          <p class="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Total Hits Extracted</p>
          <p class="text-2xl font-black text-emerald-400 mt-1 font-mono">${botStats.totalHitsProcessed}</p>
        </div>
        <div class="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80">
          <p class="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Memory Usage</p>
          <p class="text-2xl font-black text-sky-400 mt-1 font-mono">${totalMem - freeMem} <span class="text-xs text-slate-500">/ ${totalMem} MB</span></p>
        </div>
      </div>

      <!-- Visual Charts Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div class="bg-slate-950/50 p-5 rounded-xl border border-slate-800">
          <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <i class="fa-solid fa-earth-americas text-sky-400"></i> Country Distribution
          </h3>
          <div class="h-48 flex justify-center items-center">
            <canvas id="countryChart"></canvas>
          </div>
        </div>
        <div class="bg-slate-950/50 p-5 rounded-xl border border-slate-800">
          <h3 class="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-2">
            <i class="fa-solid fa-layer-group text-purple-400"></i> Plan Tier Distribution
          </h3>
          <div class="h-48 flex justify-center items-center">
            <canvas id="planChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Active SQLite Hits Table -->
      <div class="bg-slate-950/50 rounded-xl p-5 border border-slate-800 mb-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-sm font-bold text-slate-200 flex items-center gap-2">
            <i class="fa-solid fa-clock-rotate-left text-amber-400"></i> Active 1-Hour SQLite Session Records
          </h3>
          <span class="text-xs text-slate-500">Auto-deletes after 1 hour</span>
        </div>
        <div class="overflow-x-auto custom-scroll">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="border-b border-slate-800 text-slate-400 text-[11px] uppercase tracking-wider">
                <th class="py-2.5 px-3">Hit</th>
                <th class="py-2.5 px-3">Email</th>
                <th class="py-2.5 px-3">Country</th>
                <th class="py-2.5 px-3">Plan</th>
                <th class="py-2.5 px-3">Price</th>
                <th class="py-2.5 px-3">SQLite TTL</th>
              </tr>
            </thead>
            <tbody>
              ${recentRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Keep Alive Section -->
      <div class="bg-slate-950/50 rounded-xl p-5 border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 text-xs text-slate-400">
        <div class="space-y-1">
          <p><strong class="text-slate-200"><i class="fa-solid fa-heartbeat text-red-500 mr-1"></i> Keep-Alive Ping Service:</strong> Active (Pings every 2m)</p>
          <p><strong>Host Target:</strong> <code class="text-sky-300 bg-slate-900 px-2 py-0.5 rounded font-mono break-all">${HOST_URL}</code></p>
        </div>
        <div class="text-left md:text-right space-y-1">
          <p><strong>Total Self-Pings:</strong> <span class="text-emerald-400 font-bold font-mono">${botStats.totalPingsSent}</span></p>
          <p><strong>Database Engine:</strong> <span class="text-purple-400 font-bold">${sqliteEngineMode}</span></p>
        </div>
      </div>

    </div>

    <script>
      const countryCtx = document.getElementById('countryChart').getContext('2d');
      new Chart(countryCtx, {
        type: 'bar',
        data: {
          labels: ${countryLabels},
          datasets: [{
            label: 'Hits',
            data: ${countryData},
            backgroundColor: '#38bdf8',
            borderRadius: 6
          }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
      });

      const planCtx = document.getElementById('planChart').getContext('2d');
      new Chart(planCtx, {
        type: 'doughnut',
        data: {
          labels: ${planLabels},
          datasets: [{
            data: ${planData},
            backgroundColor: ['#ef4444', '#a855f7', '#3b82f6', '#10b981', '#f59e0b']
          }]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    </script>
  </body>
  </html>
  `;
  res.send(htmlResponse);
});

app.get('/api/stats', (req, res) => {
  res.json({
    status: 'online',
    uptime: process.uptime(),
    activeSqliteHitsCount: SqliteDatabase.getAllActiveHits().length,
    stats: botStats
  });
});

app.listen(PORT, () => {
  console.log(`[Express Web Engine] Server operational on port ${PORT}`);
});

// Self-ping keep-alive loop (2 minutes = 120,000 ms)
const PING_INTERVAL = 2 * 60 * 1000;
setInterval(async () => {
  try {
    botStats.totalPingsSent++;
    botStats.lastPingTime = new Date();
    await axios.get(HOST_URL);
    console.log(`[Keep-Alive Ping #${botStats.totalPingsSent}] Successfully pinged ${HOST_URL} at ${botStats.lastPingTime.toISOString()}`);
  } catch (error) {
    console.error(`[Keep-Alive Ping Failed] Host ping error:`, error.message);
  }
}, PING_INTERVAL);

const bot = new TelegramBot(TOKEN, { polling: true });

if (typeof bot.on === 'function') {
  bot.on('polling_error', (error) => {
    console.error('[Telegram Polling Error]', error.code || '', error.message || error);
  });
}

function isUserAuthorized(userId) {
  if (!ALLOWED_USERS || ALLOWED_USERS.length === 0) return true;
  return ALLOWED_USERS.includes(String(userId));
}

function parseNetflixLog(rawText) {
  const metadataMatch = rawText.match(/Generated:\s*(.+)\nSource:\s*(.+)\nTotal Checked:\s*(\d+)\nHits:\s*(\d+)/i);
  
  const metadata = {
    generated: metadataMatch ? metadataMatch[1].trim() : new Date().toISOString(),
    source: metadataMatch ? metadataMatch[2].trim() : 'Direct Text Paste / File Upload',
    totalChecked: metadataMatch ? parseInt(metadataMatch[3], 10) : 0,
    hitsCount: metadataMatch ? parseInt(metadataMatch[4], 10) : 0
  };

  const hitDividerRegex = /================================================== HIT #\d+ ==================================================/g;
  const rawHitBlocks = rawText.split(hitDividerRegex);

  if (rawHitBlocks.length > 1 && !rawHitBlocks[0].includes('Account Details:')) {
    rawHitBlocks.shift();
  }

  const parsedHits = [];

  rawHitBlocks.forEach((block, index) => {
    if (!block.trim()) return;

    const extractField = (pattern, fallback = 'N/A') => {
      const match = block.match(pattern);
      return match ? match[1].trim() : fallback;
    };

    const hitObj = {
      hitNumber: index + 1,
      generated: extractField(/Generated:\s*(.+)/),
      expires: extractField(/Expires:\s*(.+)/),
      remaining: extractField(/Remaining:\s*(.+)/),
      email: extractField(/• Email:\s*(.+)/),
      country: extractField(/• Country:\s*(.+)/),
      plan: extractField(/• Plan:\s*(.+)/),
      price: extractField(/• Price:\s*(.+)/),
      memberSince: extractField(/• Member Since:\s*(.+)/),
      nextBilling: extractField(/• Next Billing:\s*(.+)/),
      payment: extractField(/• Payment:\s*(.+)/),
      phone: extractField(/• Phone:\s*(.+)/),
      quality: extractField(/• Quality:\s*(.+)/),
      streams: extractField(/• Streams:\s*(.+)/),
      holdStatus: extractField(/• Hold Status:\s*(.+)/),
      extraMember: extractField(/• Extra Member:\s*(.+)/),
      profiles: extractField(/• Profiles:\s*(.+)/),
      cookie: extractField(/• Cookie:\s*(.+)/),
      phoneLogin: extractField(/📱 Phone Login:\s*(.+)/),
      pcLogin: extractField(/🖥️ PC Login:\s*(.+)/),
      loginLink: extractField(/🔑 Login Link:\s*(.+)/)
    };

    if (hitObj.country !== 'N/A') {
      botStats.countryBreakdown[hitObj.country] = (botStats.countryBreakdown[hitObj.country] || 0) + 1;
    }
    if (hitObj.plan !== 'N/A') {
      botStats.planBreakdown[hitObj.plan] = (botStats.planBreakdown[hitObj.plan] || 0) + 1;
    }

    parsedHits.push(hitObj);
  });

  return { metadata, hits: parsedHits };
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function executeTelegramAnimation(chatId) {
  const animationFrames = [
    "⠋ ⚡ **[▒▒▒▒▒▒▒▒▒▒] 0%** — *Connecting to stream log intake...*",
    "⠙ 🔍 **[██▒▒▒▒▒▒▒▒] 20%** — *Reading text structures & delimiters...*",
    "⠹ ⚙️ **[████▒▒▒▒▒▒] 40%** — *Extracting account attributes & cookies...*",
    "⠸ 🔐 **[██████▒▒▒▒] 60%** — *Saving hits to 1-Hour SQLite Session DB...*",
    "⠼ 🎨 **[████████▒▒] 80%** — *Building interactive action buttons...*",
    "✨ **[██████████] 100%** — *Finalizing batch output cards...*"
  ];

  const initialMsg = await bot.sendMessage(chatId, animationFrames[0], { parse_mode: 'Markdown' });

  for (let i = 1; i < animationFrames.length; i++) {
    await delay(850);
    try {
      await bot.editMessageText(animationFrames[i], {
        chat_id: chatId,
        message_id: initialMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (err) {
      // Ignored non-critical animation edit errors
    }
  }

  return initialMsg.message_id;
}

async function processAndSendResults(chatId, textContent) {
  const statusMsgId = await executeTelegramAnimation(chatId);

  try {
    const parsedData = parseNetflixLog(textContent);
    const { metadata, hits } = parsedData;

    if (!hits || hits.length === 0) {
      await bot.editMessageText("❌ **Parsing Failed!** No valid Netflix hit records were identified in the payload.", {
        chat_id: chatId,
        message_id: statusMsgId,
        parse_mode: 'Markdown'
      });
      return;
    }

    botStats.totalParsedFiles++;
    botStats.totalHitsProcessed += hits.length;

    // Generate unique Session ID & timestamps for 1-Hour SQLite TTL
    const sessionId = `sess_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const createdAt = Date.now();
    const expiresAt = createdAt + (60 * 60 * 1000); // Expiration: exactly 1 hour from now

    // Insert hits into SQLite database
    for (const hit of hits) {
      const dbRecord = {
        id: `hit_${sessionId}_${hit.hitNumber}`,
        session_id: sessionId,
        hit_number: hit.hitNumber,
        email: hit.email,
        country: hit.country,
        plan: hit.plan,
        price: hit.price,
        member_since: hit.memberSince,
        next_billing: hit.nextBilling,
        payment: hit.payment,
        phone: hit.phone,
        quality: hit.quality,
        streams: hit.streams,
        hold_status: hit.holdStatus,
        extra_member: hit.extraMember,
        profiles: hit.profiles,
        cookie: hit.cookie,
        phone_login: hit.phoneLogin,
        pc_login: hit.pcLogin,
        login_link: hit.loginLink,
        created_at: createdAt,
        expires_at: expiresAt
      };

      SqliteDatabase.saveHit(dbRecord);
    }

    await bot.editMessageText(`✅ **Parsing Complete!** Stored **${hits.length}** hits in SQLite DB for 1 hour. Dispatching cards below...`, {
      chat_id: chatId,
      message_id: statusMsgId,
      parse_mode: 'Markdown'
    });

    let exportTxtContent = `====================================================\nNETFLIX BATCH EXPORT - PARSED HITS (${hits.length})\nSession ID: ${sessionId}\nDate: ${new Date().toLocaleString()}\nSource: ${metadata.source}\n====================================================\n\n`;

    for (const hit of hits) {
      const countryFlag = getCountryFlag(hit.country);
      const hitMessage = 
`🎬 **NETFLIX HIT #${hit.hitNumber}**
====================================
📅 **Generated:** \`${hit.generated}\`
⌛ **Expires:** \`${hit.expires}\` (\`${hit.remaining}\`)

👤 **ACCOUNT DETAILS:**
• **Email:** \`${hit.email}\`
• **Country:** ${countryFlag} \`${hit.country}\`
• **Plan:** \`${hit.plan}\` (${hit.price})
• **Member Since:** \`${hit.memberSince}\`
• **Next Billing:** \`${hit.nextBilling}\`
• **Payment Method:** \`${hit.payment}\`
• **Phone:** \`${hit.phone}\`
• **Quality:** \`${hit.quality}\` | **Streams:** \`${hit.streams}\`
• **Hold Status:** \`${hit.holdStatus}\` | **Extra Member:** \`${hit.extraMember}\`
• **Profiles:** \`${hit.profiles}\`

🍪 **COPYABLE COOKIE:**
\`\`\`text
${hit.cookie}
\`\`\``;

      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: "📱 Phone Login", url: isValidUrl(hit.phoneLogin) ? hit.phoneLogin : 'https://www.netflix.com' },
            { text: "🖥️ PC Login", url: isValidUrl(hit.pcLogin) ? hit.pcLogin : 'https://www.netflix.com' }
          ],
          [
            { text: "🔑 Direct Login Link", url: isValidUrl(hit.loginLink) ? hit.loginLink : 'https://www.netflix.com' }
          ]
        ]
      };

      await bot.sendMessage(chatId, hitMessage, {
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard
      });

      exportTxtContent += `--- HIT #${hit.hitNumber} ---\nEmail: ${hit.email}\nCountry: ${hit.country}\nPlan: ${hit.plan}\nCookie:\n${hit.cookie}\nPC Login Link: ${hit.pcLogin}\n\n`;

      await delay(350);
    }

    const summaryCard = 
`📊 **BATCH PARSING SUMMARY REPORT**
====================================
📁 **Source:** \`${metadata.source}\`
⏱️ **Processed At:** \`${new Date().toLocaleString()}\`
🔢 **Total Log Hits:** \`${hits.length}\`
💾 **SQLite Session:** \`${sessionId}\`
🕒 **Database Retention:** \`1 HOUR (Auto-Deletes at ${new Date(expiresAt).toLocaleTimeString()})\`
====================================
👇 *Use the interactive buttons below within 1 hour to query SQLite detections & filter metrics:*`;

    const summaryButtons = {
      inline_keyboard: [
        [
          { text: "🛡️ Risk & Hold Detections", callback_data: `detect:${sessionId}` },
          { text: "💎 Premium / UHD Only", callback_data: `premium:${sessionId}` }
        ],
        [
          { text: "🌐 Country Breakdown", callback_data: `country:${sessionId}` },
          { text: "📱 Phone Linked Hits", callback_data: `phone:${sessionId}` }
        ],
        [
          { text: "🕒 SQLite Session TTL", callback_data: `ttl:${sessionId}` },
          { text: "📥 Export Clean Cookies", callback_data: `export_db:${sessionId}` }
        ]
      ]
    };

    await bot.sendMessage(chatId, summaryCard, {
      parse_mode: 'Markdown',
      reply_markup: summaryButtons
    });

  } catch (error) {
    console.error('[Processing Error]', error);
    await bot.sendMessage(chatId, `⚠️ **An error occurred during log parsing.**\nError Details: \`${error.message}\``, { parse_mode: 'Markdown' });
  }
}

function isValidUrl(urlString) {
  try {
    return urlString && urlString.startsWith('http');
  } catch (e) {
    return false;
  }
}

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (typeof bot.answerCallbackQuery === 'function') {
    bot.answerCallbackQuery(query.id);
  }

  const [action, sessionId] = data.split(':');
  const sessionHits = SqliteDatabase.getHitsBySession(sessionId);

  if (!sessionHits || sessionHits.length === 0) {
    return bot.sendMessage(chatId, `⌛ **SQLite Session Expired or Purged!**\nSession \`${sessionId}\` has passed the 1-hour retention window and was automatically deleted.`, { parse_mode: 'Markdown' });
  }

  if (action === 'detect') {
    const holdHits = sessionHits.filter(h => h.hold_status.toLowerCase() === 'yes' || h.hold_status.toLowerCase() === 'true');
    const extraMemberHits = sessionHits.filter(h => h.extra_member.toLowerCase() === 'yes' || h.extra_member.toLowerCase() === 'true');
    const unlinkedPhoneHits = sessionHits.filter(h => h.phone.includes('(No)'));

    let report = `🛡️ **SECURITY & ACCOUNT RISK DETECTIONS**\n====================================\n`;
    report += `💳 **Payment Hold Flagged:** \`${holdHits.length} accounts\`\n`;
    report += `👥 **Extra Member Profiles:** \`${extraMemberHits.length} accounts\`\n`;
    report += `📱 **Unlinked Phone Accounts:** \`${unlinkedPhoneHits.length} accounts\`\n\n`;

    if (holdHits.length > 0) {
      report += `⚠️ **Hold Accounts List:**\n`;
      holdHits.forEach(h => {
        report += `• \`${h.email}\` (${h.country})\n`;
      });
    } else {
      report += `✅ *No accounts are currently on payment hold in this session.*`;
    }

    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  else if (action === 'premium') {
    const premiumHits = sessionHits.filter(h => 
      h.plan.toLowerCase().includes('premium') || 
      h.quality.toLowerCase().includes('uhd') || 
      h.streams === '4'
    );

    let report = `💎 **PREMIUM & UHD 4K ACCOUNTS (${premiumHits.length} Found)**\n====================================\n`;
    if (premiumHits.length === 0) {
      report += `ℹ️ *No UHD / Premium plan accounts detected in this batch.*`;
    } else {
      premiumHits.forEach((h, i) => {
        report += `**#${i+1} | ${getCountryFlag(h.country)} ${h.email}**\n• Plan: \`${h.plan}\` | Streams: \`${h.streams}\` | Quality: \`${h.quality}\`\n\n`;
      });
    }

    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  else if (action === 'country') {
    const countryCounts = {};
    sessionHits.forEach(h => {
      countryCounts[h.country] = (countryCounts[h.country] || 0) + 1;
    });

    let report = `🌐 **SESSION COUNTRY BREAKDOWN**\n====================================\n`;
    Object.entries(countryCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([c, count]) => {
        report += `• ${getCountryFlag(c)} **${c}:** \`${count} hits\`\n`;
      });

    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  else if (action === 'phone') {
    const phoneHits = sessionHits.filter(h => !h.phone.includes('(No)') && h.phone !== 'Unknown' && h.phone !== 'N/A');

    let report = `📱 **VERIFIED PHONE LINKED ACCOUNTS (${phoneHits.length} Found)**\n====================================\n`;
    if (phoneHits.length === 0) {
      report += `ℹ️ *No accounts with active phone numbers found in this session.*`;
    } else {
      phoneHits.forEach(h => {
        report += `• \`${h.email}\` ➔ Phone: \`${h.phone}\` (${h.country})\n`;
      });
    }

    bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  else if (action === 'ttl') {
    const sample = sessionHits[0];
    const remainingMs = sample.expires_at - Date.now();
    const remainingMins = Math.max(0, Math.floor(remainingMs / (1000 * 60)));
    const remainingSecs = Math.max(0, Math.floor((remainingMs % (1000 * 60)) / 1000));

    const ttlMessage = 
`🕒 **SQLITE DATABASE RETENTION TIMER**
====================================
🆔 **Session ID:** \`${sessionId}\`
📊 **Stored Records:** \`${sessionHits.length} hits\`
⌛ **Remaining TTL:** \`${remainingMins}m ${remainingSecs}s\`
====================================
*Once this timer reaches 00m 00s, the SQLite engine automatically purges all records for this session.*`;

    bot.sendMessage(chatId, ttlMessage, { parse_mode: 'Markdown' });
  }

  else if (action === 'export_db') {
    let exportTxt = `====================================================\nSQLITE SESSION EXPORT (${sessionHits.length} HITS)\nSession ID: ${sessionId}\nPurge Time: ${new Date(sessionHits[0].expires_at).toLocaleString()}\n====================================================\n\n`;

    sessionHits.forEach(h => {
      exportTxt += `[HIT #${h.hit_number}]\nEmail: ${h.email}\nCountry: ${h.country}\nPlan: ${h.plan}\nCookie:\n${h.cookie}\n\n`;
    });

    const buffer = Buffer.from(exportTxt, 'utf-8');
    if (typeof bot.sendDocument === 'function') {
      await bot.sendDocument(chatId, buffer, {
        caption: `📄 **Session_${sessionId}_Clean_Cookies.txt**\nContains ${sessionHits.length} active cookies from SQLite.`
      }, {
        filename: `Session_${sessionId}_Clean_Cookies.txt`
      });
    }
  }
});

bot.onText(/\/export/, async (msg) => {
  if (!isUserAuthorized(msg.from.id)) return;

  const activeHits = SqliteDatabase.getAllActiveHits();
  if (activeHits.length === 0) {
    return bot.sendMessage(msg.chat.id, "⚠️ *No active SQLite session hits available to export.*", { parse_mode: 'Markdown' });
  }

  const exportData = {
    exportedAt: new Date().toISOString(),
    totalActiveSqliteHits: activeHits.length,
    hits: activeHits
  };

  const buffer = Buffer.from(JSON.stringify(exportData, null, 2), 'utf-8');
  await bot.sendDocument(msg.chat.id, buffer, {
    caption: `📥 **Netflix_SQLite_Active_Export_${Date.now()}.json**\nContains ${activeHits.length} active SQLite session hits.`
  }, {
    filename: `Netflix_SQLite_Active_Export_${Date.now()}.json`
  });
});

bot.onText(/\/search (.+)/, (msg, match) => {
  if (!isUserAuthorized(msg.from.id)) return;

  const query = match[1].trim().toLowerCase();
  const activeHits = SqliteDatabase.getAllActiveHits();
  const matchedHits = activeHits.filter(h => 
    h.email.toLowerCase().includes(query) ||
    h.country.toLowerCase().includes(query) ||
    h.plan.toLowerCase().includes(query)
  );

  if (matchedHits.length === 0) {
    return bot.sendMessage(msg.chat.id, `🔍 No active SQLite hits found matching query: \`${query}\``, { parse_mode: 'Markdown' });
  }

  let searchReport = `🔎 **SEARCH RESULTS FOR "${query}" (${matchedHits.length} found):**\n====================================\n`;
  matchedHits.slice(0, 8).forEach((h, i) => {
    searchReport += `\n**#${i + 1} | ${getCountryFlag(h.country)} ${h.email}**\n• **Plan:** \`${h.plan}\` | **Price:** \`${h.price}\`\n• **Cookie:** \`${h.cookie.substring(0, 40)}...\`\n`;
  });

  bot.sendMessage(msg.chat.id, searchReport, { parse_mode: 'Markdown' });
});

bot.onText(/\/plans/, (msg) => {
  if (!isUserAuthorized(msg.from.id)) return;

  const planEntries = Object.entries(botStats.planBreakdown);
  if (planEntries.length === 0) {
    return bot.sendMessage(msg.chat.id, "📊 *No plan analytics recorded in current session.*", { parse_mode: 'Markdown' });
  }

  let planReport = `📊 **NETFLIX SUBSCRIPTION PLAN BREAKDOWN**\n====================================\n`;
  planEntries.sort((a, b) => b[1] - a[1]).forEach(([plan, count]) => {
    planReport += `• **${plan}:** \`${count} hits\`\n`;
  });

  bot.sendMessage(msg.chat.id, planReport, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, (msg) => {
  if (!isUserAuthorized(msg.from.id)) return;

  const uptimeMs = Date.now() - botStats.startTime.getTime();
  const uptimeMins = (uptimeMs / (1000 * 60)).toFixed(1);

  const topCountries = Object.entries(botStats.countryBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([c, count]) => `• **${c}:** \`${count} hits\``)
    .join('\n') || '• None recorded yet';

  const statsMessage = 
`📈 **SYSTEM ANALYTICS & BOT STATS**
====================================
⏱️ **Uptime:** \`${uptimeMins} minutes\`
📁 **Files Processed:** \`${botStats.totalParsedFiles}\`
🎯 **Total Hits Extracted:** \`${botStats.totalHitsProcessed}\`
💾 **Active 1-Hour SQLite Hits:** \`${SqliteDatabase.getAllActiveHits().length}\`
⚙️ **SQLite Engine:** \`${sqliteEngineMode}\`
🔄 **Auto-Keepalive Pings:** \`${botStats.totalPingsSent}\`

🌍 **TOP COUNTRIES BREAKDOWN:**
${topCountries}
====================================`;

  bot.sendMessage(msg.chat.id, statsMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/ping/, async (msg) => {
  if (!isUserAuthorized(msg.from.id)) return;

  const startMs = Date.now();
  const sentMsg = await bot.sendMessage(msg.chat.id, "🏓 *Pinging server...*", { parse_mode: 'Markdown' });
  const latency = Date.now() - startMs;

  bot.editMessageText(`🏓 **Pong!** Bot Response Latency: \`${latency}ms\``, {
    chat_id: msg.chat.id,
    message_id: sentMsg.message_id,
    parse_mode: 'Markdown'
  });
});

bot.on('text', async (msg) => {
  if (!isUserAuthorized(msg.from.id) || msg.text.startsWith('/')) return;

  if (msg.text.includes("HIT #") || msg.text.includes("Netflix Token Results") || msg.text.includes("Account Details:")) {
    await processAndSendResults(msg.chat.id, msg.text);
  } else {
    bot.sendMessage(msg.chat.id, "💡 *Send or forward a valid Netflix log file (.txt) or direct log text paste.*", { parse_mode: 'Markdown' });
  }
});

bot.on('document', async (msg) => {
  if (!isUserAuthorized(msg.from.id)) return;

  const chatId = msg.chat.id;
  const doc = msg.document;

  if (!doc.file_name.toLowerCase().endsWith('.txt') && !doc.file_name.toLowerCase().endsWith('.log')) {
    bot.sendMessage(chatId, "⚠️ *Please send a valid `.txt` or `.log` file.*", { parse_mode: 'Markdown' });
    return;
  }

  try {
    const fileLink = await bot.getFileLink(doc.file_id);
    const response = await axios.get(fileLink, { responseType: 'text' });
    await processAndSendResults(chatId, response.data);
  } catch (error) {
    console.error('[File Download Error]', error);
    bot.sendMessage(chatId, "❌ *Failed to download or read the uploaded document.*", { parse_mode: 'Markdown' });
  }
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]', reason);
});