const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const API_KEY = process.env.API_KEY;
const app = express();

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve static frontend admin panel files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Set up PostgreSQL client pool
const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 5432,
});

// Helper for hashing passwords
function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd + '_pdks_salt').digest('hex');
}

// In-memory active session tokens
const activeSessions = new Map();

function createSessionToken(username) {
  const token = 'sess_' + crypto.randomBytes(24).toString('hex');
  activeSessions.set(token, { username, createdAt: Date.now() });
  return token;
}

// Run database schema migration and seed default admin credentials (adnan / mutlu)
async function initDbSchema() {
  try {
    await pool.query(`ALTER TABLE workers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ACTIVE';`);
    await pool.query(`UPDATE workers SET status = 'ACTIVE' WHERE status IS NULL;`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default admin account (adnan / mutlu)
    const defaultHash = hashPassword('mutlu');
    await pool.query(
      `INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO NOTHING;`,
      ['adnan', defaultHash]
    );

    console.log('[DB] Verified database schema & admin accounts.');
  } catch (err) {
    console.error('[DB] Migration error:', err.message);
  }
}
initDbSchema();

// In-memory buffer for unknown card scans
const unknownScansMap = new Map();

function recordUnknownScan(card_id, serial, ip) {
  const scanObj = {
    id: `unk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    card_id,
    serial: serial || 'CDS-A3-001',
    ip: ip || '—',
    timestamp: new Date().toISOString()
  };
  unknownScansMap.set(card_id, scanObj);
}

function getApiKeyFromHeader(req) {
  const token = req.get('X-Device-Token') || req.get('Authorization')?.replace('Bearer ', '');
  return token ? token.trim() : undefined;
}

function requireApiKey(req, res, next) {
  const suppliedKey = getApiKeyFromHeader(req);
  if (API_KEY && suppliedKey && suppliedKey === API_KEY) {
    return next();
  }
  if (!API_KEY) {
    return next();
  }
  console.warn(`[AUTH] Unauthorized request from ${req.ip} to ${req.originalUrl}`);
  return res.status(401).json({ status: 'error', message: 'Unauthorized: Invalid or missing API key' });
}

// Middleware for Admin REST endpoints: checks session token or API key
function adminAuthMiddleware(req, res, next) {
  const token = getApiKeyFromHeader(req) || req.get('X-Session-Token');
  
  if (token && activeSessions.has(token)) {
    req.adminUser = activeSessions.get(token);
    return next();
  }

  if (API_KEY && token && token === API_KEY) {
    return next();
  }

  // If no sessions exist yet or API_KEY is disabled, allow access
  if (!API_KEY && activeSessions.size === 0) {
    return next();
  }

  return res.status(401).json({ status: 'error', message: 'Unauthorized: Please log in first' });
}

// -------------------------------------------------------------------
// 1. ESP32 Attendance Request Endpoint
// -------------------------------------------------------------------
app.post('/api/v1/request', requireApiKey, async (req, res) => {
  const { card_id, direction, serial, ip, fw } = req.body;

  if (!card_id || !serial) {
    return res.status(400).json({ status: "error", message: "Missing card_id or serial" });
  }

  try {
    // 1. Verify if worker is registered
    const workerCheck = await pool.query('SELECT * FROM workers WHERE card_id = $1', [card_id]);
    
    if (workerCheck.rows.length === 0) {
      console.log(`[REJECTED] Unregistered Card ID scanned: ${card_id}`);
      recordUnknownScan(card_id, serial, ip);
      return res.status(403).json({ status: "error", message: "Access Denied: Unregistered card", card_id });
    }

    const worker = workerCheck.rows[0];
    const workerStatus = (worker.status || 'ACTIVE').toUpperCase();

    // 2. Check if worker status is PASSIVE / INACTIVE
    if (workerStatus === 'PASSIVE' || workerStatus === 'INACTIVE') {
      console.log(`[REJECTED] Passive worker card scanned: ${card_id} (${worker.name} ${worker.surname})`);
      return res.status(403).json({
        status: "error",
        message: `Access Denied: ${worker.name} ${worker.surname} is marked as PASSIVE`
      });
    }

    // 3. Determine direction automatically if omitted
    let resolvedDirection = direction ? direction.toUpperCase() : null;
    if (!resolvedDirection || (resolvedDirection !== 'IN' && resolvedDirection !== 'OUT')) {
      const lastScan = await pool.query(
        'SELECT direction FROM attendance_logs WHERE card_id = $1 ORDER BY scanned_at DESC LIMIT 1',
        [card_id]
      );
      resolvedDirection = (lastScan.rows.length === 0 || lastScan.rows[0].direction === 'OUT') ? 'IN' : 'OUT';
    }

    // 4. Insert scan log
    await pool.query(
      'INSERT INTO attendance_logs (card_id, direction, device_serial, ip_address, firmware) VALUES ($1, $2, $3, $4, $5)',
      [card_id, resolvedDirection, serial, ip, fw]
    );

    console.log(`[SUCCESS] ${worker.name} ${worker.surname} clocked ${resolvedDirection}.`);

    return res.status(200).json({
      status: "success",
      message: `Welcome, ${worker.name}`,
      worker: `${worker.name} ${worker.surname}`,
      direction: resolvedDirection
    });

  } catch (err) {
    console.error("Database error: ", err);
    return res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

// -------------------------------------------------------------------
// 2. Admin Authentication (Login & Logout) Endpoints
// -------------------------------------------------------------------

// Admin Login Endpoint
app.post('/api/v1/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Username and password are required' });
  }

  try {
    const userRes = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username.trim()]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    }

    const admin = userRes.rows[0];
    const inputHash = hashPassword(password);

    if (inputHash !== admin.password_hash) {
      return res.status(401).json({ status: 'error', message: 'Invalid username or password' });
    }

    const token = createSessionToken(admin.username);
    console.log(`[AUTH] Admin user '${admin.username}' logged in successfully.`);

    res.json({
      status: 'success',
      message: 'Login successful',
      token,
      username: admin.username
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ status: 'error', message: 'Authentication failed' });
  }
});

// Admin Logout Endpoint
app.post('/api/v1/admin/logout', adminAuthMiddleware, (req, res) => {
  const token = getApiKeyFromHeader(req) || req.get('X-Session-Token');
  if (token) {
    activeSessions.delete(token);
  }
  res.json({ status: 'success', message: 'Logged out successfully' });
});

// -------------------------------------------------------------------
// 3. Registered Admin Accounts Management Endpoints
// -------------------------------------------------------------------

// GET List Admin Accounts
app.get('/api/v1/admin/accounts', adminAuthMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, created_at FROM admin_users ORDER BY created_at ASC');
    res.json({ status: 'success', data: result.rows });
  } catch (err) {
    console.error('Fetch admin accounts error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch admin accounts' });
  }
});

// POST Register New Admin Account
app.post('/api/v1/admin/accounts', adminAuthMiddleware, async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ status: 'error', message: 'Username and password are required' });
  }

  const cleanUsername = username.trim();
  if (cleanUsername.length < 3) {
    return res.status(400).json({ status: 'error', message: 'Username must be at least 3 characters' });
  }

  try {
    const checkDup = await pool.query('SELECT id FROM admin_users WHERE username = $1', [cleanUsername]);
    if (checkDup.rows.length > 0) {
      return res.status(409).json({ status: 'error', message: `Username '${cleanUsername}' is already registered` });
    }

    const pwdHash = hashPassword(password);
    const insertRes = await pool.query(
      'INSERT INTO admin_users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [cleanUsername, pwdHash]
    );

    res.status(201).json({
      status: 'success',
      message: `Admin account '${cleanUsername}' created successfully`,
      data: insertRes.rows[0]
    });
  } catch (err) {
    console.error('Create admin account error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to create admin account' });
  }
});

// DELETE Remove Admin Account
app.delete('/api/v1/admin/accounts/:id', adminAuthMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const totalCountRes = await pool.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(totalCountRes.rows[0].count, 10) <= 1) {
      return res.status(400).json({ status: 'error', message: 'Cannot delete the only remaining admin account' });
    }

    const deleteRes = await pool.query('DELETE FROM admin_users WHERE id = $1 RETURNING username', [id]);
    if (deleteRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Admin account not found' });
    }

    res.json({
      status: 'success',
      message: `Admin account '${deleteRes.rows[0].username}' removed successfully`
    });
  } catch (err) {
    console.error('Delete admin account error:', err);
    res.status(500).json({ status: 'error', message: 'Failed to delete admin account' });
  }
});

// -------------------------------------------------------------------
// 4. Admin Dashboard & Management REST API Endpoints
// -------------------------------------------------------------------

// GET Unknown Scans Notifications List
app.get('/api/v1/admin/unknown-scans', adminAuthMiddleware, (req, res) => {
  const list = Array.from(unknownScansMap.values());
  res.json({ status: 'success', data: list });
});

// DELETE Dismiss Unknown Scan Notification
app.delete('/api/v1/admin/unknown-scans/:card_id', adminAuthMiddleware, (req, res) => {
  const { card_id } = req.params;
  unknownScansMap.delete(card_id.trim());
  res.json({ status: 'success', message: 'Notification dismissed' });
});

// Dashboard Stats Endpoint
app.get('/api/v1/admin/stats', adminAuthMiddleware, async (req, res) => {
  try {
    const totalWorkersRes = await pool.query("SELECT COUNT(*) FROM workers WHERE COALESCE(status, 'ACTIVE') = 'ACTIVE'");
    const totalPassiveWorkersRes = await pool.query("SELECT COUNT(*) FROM workers WHERE UPPER(status) = 'PASSIVE'");
    const totalScansTodayRes = await pool.query(
      "SELECT COUNT(*) FROM attendance_logs WHERE scanned_at >= CURRENT_DATE"
    );
    
    // Calculate currently present workers
    const currentlyPresentRes = await pool.query(`
      WITH LatestScans AS (
        SELECT DISTINCT ON (l.card_id) l.card_id, l.direction, l.scanned_at, w.status
        FROM attendance_logs l
        JOIN workers w ON l.card_id = w.card_id
        ORDER BY l.card_id, l.scanned_at DESC
      )
      SELECT COUNT(*) AS count FROM LatestScans 
      WHERE UPPER(direction) = 'IN' AND UPPER(COALESCE(status, 'ACTIVE')) = 'ACTIVE'
    `);

    const activeDevicesRes = await pool.query(
      'SELECT COUNT(DISTINCT device_serial) FROM attendance_logs WHERE device_serial IS NOT NULL'
    );

    const recentScansRes = await pool.query(`
      SELECT l.id, l.card_id, l.direction, l.scanned_at, w.name, w.surname, COALESCE(w.status, 'ACTIVE') AS status
      FROM attendance_logs l
      LEFT JOIN workers w ON l.card_id = w.card_id
      ORDER BY l.scanned_at DESC
      LIMIT 5
    `);

    res.json({
      status: 'success',
      data: {
        total_workers: parseInt(totalWorkersRes.rows[0].count, 10),
        passive_workers: parseInt(totalPassiveWorkersRes.rows[0].count, 10),
        scans_today: parseInt(totalScansTodayRes.rows[0].count, 10),
        currently_present: parseInt(currentlyPresentRes.rows[0].count, 10),
        active_devices: parseInt(activeDevicesRes.rows[0].count, 10),
        recent_scans: recentScansRes.rows,
        unknown_scans: Array.from(unknownScansMap.values())
      }
    });
  } catch (err) {
    console.error("Stats fetch error:", err);
    res.status(500).json({ status: 'error', message: 'Failed to compute dashboard stats' });
  }
});

// GET Workers List with optional search query & status filter
app.get('/api/v1/admin/workers', adminAuthMiddleware, async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search.trim()}%` : null;
    const statusFilter = req.query.status && req.query.status !== 'ALL' ? req.query.status.toUpperCase() : null;

    const query = `
      SELECT 
        w.card_id, 
        w.name, 
        w.surname,
        COALESCE(w.status, 'ACTIVE') AS status,
        ls.direction AS last_direction,
        ls.scanned_at AS last_scanned_at
      FROM workers w
      LEFT JOIN (
        SELECT DISTINCT ON (card_id) card_id, direction, scanned_at
        FROM attendance_logs
        ORDER BY card_id, scanned_at DESC
      ) ls ON w.card_id = ls.card_id
      WHERE ($1::text IS NULL OR 
             w.card_id ILIKE $1 OR 
             w.name ILIKE $1 OR 
             w.surname ILIKE $1)
        AND ($2::text IS NULL OR UPPER(COALESCE(w.status, 'ACTIVE')) = $2)
      ORDER BY w.name ASC, w.surname ASC;
    `;

    const result = await pool.query(query, [search, statusFilter]);
    res.json({ status: 'success', count: result.rows.length, data: result.rows });
  } catch (err) {
    console.error("Workers list error:", err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch workers' });
  }
});

// POST Register a New Worker
app.post('/api/v1/admin/workers', adminAuthMiddleware, async (req, res) => {
  const { card_id, name, surname, status } = req.body;

  if (!card_id || !name || !surname) {
    return res.status(400).json({ status: 'error', message: 'Card ID, Name, and Surname are required' });
  }

  const cleanCardId = card_id.trim();
  const cleanName = name.trim();
  const cleanSurname = surname.trim();
  const workerStatus = (status && status.toUpperCase() === 'PASSIVE') ? 'PASSIVE' : 'ACTIVE';

  try {
    const checkDuplicate = await pool.query('SELECT card_id FROM workers WHERE card_id = $1', [cleanCardId]);
    if (checkDuplicate.rows.length > 0) {
      return res.status(409).json({ status: 'error', message: `Worker with Card ID '${cleanCardId}' already exists` });
    }

    const insertRes = await pool.query(
      'INSERT INTO workers (card_id, name, surname, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [cleanCardId, cleanName, cleanSurname, workerStatus]
    );

    // Remove from unknown scans map if registered
    unknownScansMap.delete(cleanCardId);

    res.status(201).json({ status: 'success', message: 'Worker registered successfully', data: insertRes.rows[0] });
  } catch (err) {
    console.error("Worker create error:", err);
    res.status(500).json({ status: 'error', message: 'Failed to register worker' });
  }
});

// PUT Update Worker Details (including status)
app.put('/api/v1/admin/workers/:card_id', adminAuthMiddleware, async (req, res) => {
  const { card_id } = req.params;
  const { name, surname, status } = req.body;

  if (!name || !surname) {
    return res.status(400).json({ status: 'error', message: 'Name and Surname are required' });
  }

  const workerStatus = (status && status.toUpperCase() === 'PASSIVE') ? 'PASSIVE' : 'ACTIVE';

  try {
    const updateRes = await pool.query(
      'UPDATE workers SET name = $1, surname = $2, status = $3 WHERE card_id = $4 RETURNING *',
      [name.trim(), surname.trim(), workerStatus, card_id.trim()]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Worker not found' });
    }

    res.json({ status: 'success', message: 'Worker updated successfully', data: updateRes.rows[0] });
  } catch (err) {
    console.error("Worker update error:", err);
    res.status(500).json({ status: 'error', message: 'Failed to update worker' });
  }
});

// PATCH Toggle Worker Status (ACTIVE <-> PASSIVE)
app.patch('/api/v1/admin/workers/:card_id/status', adminAuthMiddleware, async (req, res) => {
  const { card_id } = req.params;
  const { status } = req.body;

  if (!status || (status.toUpperCase() !== 'ACTIVE' && status.toUpperCase() !== 'PASSIVE')) {
    return res.status(400).json({ status: 'error', message: 'Valid status (ACTIVE or PASSIVE) is required' });
  }

  const newStatus = status.toUpperCase();

  try {
    const updateRes = await pool.query(
      'UPDATE workers SET status = $1 WHERE card_id = $2 RETURNING *',
      [newStatus, card_id.trim()]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Worker not found' });
    }

    res.json({
      status: 'success',
      message: `Worker status changed to ${newStatus}`,
      data: updateRes.rows[0]
    });
  } catch (err) {
    console.error("Worker status toggle error:", err);
    res.status(500).json({ status: 'error', message: 'Failed to toggle worker status' });
  }
});

// Soft Delete (Deactivate) Worker Record
app.delete('/api/v1/admin/workers/:card_id', adminAuthMiddleware, async (req, res) => {
  const { card_id } = req.params;

  try {
    const updateRes = await pool.query(
      "UPDATE workers SET status = 'PASSIVE' WHERE card_id = $1 RETURNING *",
      [card_id.trim()]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Worker not found' });
    }

    res.json({
      status: 'success',
      message: `Worker ${card_id} marked as PASSIVE. Card access disabled.`
    });
  } catch (err) {
    console.error("Worker deactivate error:", err);
    res.status(500).json({ status: 'error', message: 'Failed to deactivate worker' });
  }
});

// GET Attendance Logs with filters & pagination
app.get('/api/v1/admin/attendance', adminAuthMiddleware, async (req, res) => {
  try {
    const search = req.query.search ? `%${req.query.search.trim()}%` : null;
    const direction = req.query.direction && req.query.direction !== 'ALL' ? req.query.direction.toUpperCase() : null;
    const limit = parseInt(req.query.limit, 10) || 50;
    const page = parseInt(req.query.page, 10) || 1;
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(*) 
      FROM attendance_logs l
      LEFT JOIN workers w ON l.card_id = w.card_id
      WHERE ($1::text IS NULL OR l.card_id ILIKE $1 OR w.name ILIKE $1 OR w.surname ILIKE $1)
        AND ($2::text IS NULL OR UPPER(l.direction) = $2);
    `;

    const logsQuery = `
      SELECT 
        l.id,
        l.card_id,
        l.direction,
        l.device_serial,
        l.ip_address,
        l.firmware,
        l.scanned_at,
        w.name AS worker_name,
        w.surname AS worker_surname,
        COALESCE(w.status, 'ACTIVE') AS worker_status
      FROM attendance_logs l
      LEFT JOIN workers w ON l.card_id = w.card_id
      WHERE ($1::text IS NULL OR l.card_id ILIKE $1 OR w.name ILIKE $1 OR w.surname ILIKE $1)
        AND ($2::text IS NULL OR UPPER(l.direction) = $2)
      ORDER BY l.scanned_at DESC
      LIMIT $3 OFFSET $4;
    `;

    const totalRes = await pool.query(countQuery, [search, direction]);
    const totalLogs = parseInt(totalRes.rows[0].count, 10);
    const result = await pool.query(logsQuery, [search, direction, limit, offset]);

    res.json({
      status: 'success',
      pagination: {
        total: totalLogs,
        page,
        limit,
        totalPages: Math.ceil(totalLogs / limit) || 1
      },
      data: result.rows
    });
  } catch (err) {
    console.error("Attendance logs error:", err);
    res.status(500).json({ status: 'error', message: 'Failed to fetch attendance logs' });
  }
});

// POST Manual Attendance Entry
app.post('/api/v1/admin/attendance/manual', adminAuthMiddleware, async (req, res) => {
  const { card_id, direction, device_serial } = req.body;

  if (!card_id || !direction) {
    return res.status(400).json({ status: 'error', message: 'Card ID and Direction (IN/OUT) are required' });
  }

  const cleanCardId = card_id.trim();
  const cleanDirection = direction.toUpperCase();

  if (cleanDirection !== 'IN' && cleanDirection !== 'OUT') {
    return res.status(400).json({ status: 'error', message: 'Direction must be IN or OUT' });
  }

  try {
    const workerCheck = await pool.query('SELECT name, surname, status FROM workers WHERE card_id = $1', [cleanCardId]);
    if (workerCheck.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Unregistered Card ID. Register worker first.' });
    }

    const worker = workerCheck.rows[0];
    if (worker.status && worker.status.toUpperCase() === 'PASSIVE') {
      return res.status(400).json({ status: 'error', message: `Cannot log attendance for PASSIVE worker (${worker.name} ${worker.surname}). Activate worker profile first.` });
    }

    const insertRes = await pool.query(
      'INSERT INTO attendance_logs (card_id, direction, device_serial, ip_address, firmware) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [cleanCardId, cleanDirection, device_serial || 'WEB-ADMIN', '127.0.0.1', 'WEB-1.0']
    );

    res.status(201).json({
      status: 'success',
      message: `Manual ${cleanDirection} log added for ${worker.name} ${worker.surname}`,
      data: insertRes.rows[0]
    });
  } catch (err) {
    console.error("Manual log error:", err);
    res.status(500).json({ status: 'error', message: 'Failed to insert manual attendance log' });
  }
});

// GET Export Attendance Logs as CSV
app.get('/api/v1/admin/attendance/export', adminAuthMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        l.id,
        l.scanned_at,
        l.card_id,
        w.name,
        w.surname,
        COALESCE(w.status, 'ACTIVE') AS worker_status,
        l.direction,
        l.device_serial,
        l.ip_address,
        l.firmware
      FROM attendance_logs l
      LEFT JOIN workers w ON l.card_id = w.card_id
      ORDER BY l.scanned_at DESC
    `);

    let csvContent = 'Log ID,Timestamp,Card ID,First Name,Last Name,Worker Status,Direction,Device Serial,IP Address,Firmware\n';
    result.rows.forEach(row => {
      const formattedDate = row.scanned_at ? new Date(row.scanned_at).toISOString() : '';
      csvContent += `"${row.id}","${formattedDate}","${row.card_id || ''}","${row.name || ''}","${row.surname || ''}","${row.worker_status || ''}","${row.direction || ''}","${row.device_serial || ''}","${row.ip_address || ''}","${row.firmware || ''}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="pdks_attendance_logs.csv"');
    res.send(csvContent);
  } catch (err) {
    console.error("CSV export error:", err);
    res.status(500).send('Failed to generate CSV export');
  }
});

// Serve frontend admin SPA for any fallback HTML route
app.get('*', (req, res, next) => {
  if (req.originalUrl.startsWith('/api')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = 3000;

function getLocalIPv4Addresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 PDKS REST API & Admin Panel listening on port ${PORT}`);
  const ips = getLocalIPv4Addresses();
  console.log(`🌐 Admin Web Panel: http://localhost:${PORT}`);
  if (ips.length > 0) {
    ips.forEach(ip => console.log(`🌐 Network Access: http://${ip}:${PORT}`));
  }
  console.log(`======================================================\n`);
});