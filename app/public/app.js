// ==========================================================================
// PDKS Admin Control Panel - JavaScript Core Logic & Authentication
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // App State
  const state = {
    activeTab: 'dashboard',
    apiKey: localStorage.getItem('pdks_api_key') || '',
    sessionToken: localStorage.getItem('pdks_session_token') || '',
    username: localStorage.getItem('pdks_username') || 'adnan',
    autoRefresh: true,
    autoRefreshTimer: null,
    logsCurrentPage: 1,
    logsLimit: 20,
    logsTotalPages: 1,
    workersCache: []
  };

  // -------------------------------------------------------------------
  // DOM Elements
  // -------------------------------------------------------------------
  const loginOverlay = document.getElementById('loginOverlay');
  const loginForm = document.getElementById('loginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const loginErrorMsg = document.getElementById('loginErrorMsg');
  const loggedInUsername = document.getElementById('loggedInUsername');
  const logoutBtn = document.getElementById('logoutBtn');

  const pageTitle = document.getElementById('pageTitle');
  const pageSubTitle = document.getElementById('pageSubTitle');
  const currentTimeEl = document.getElementById('currentTime');
  const serverStatusPill = document.getElementById('serverStatusPill');
  const serverStatusText = document.getElementById('serverStatusText');
  const autoRefreshToggle = document.getElementById('autoRefreshToggle');
  const globalRefreshBtn = document.getElementById('globalRefreshBtn');

  // Nav Items
  const navItems = document.querySelectorAll('.nav-item');
  const tabViews = document.querySelectorAll('.tab-view');

  // Modals
  const addWorkerModal = document.getElementById('addWorkerModal');
  const editWorkerModal = document.getElementById('editWorkerModal');
  const manualScanModal = document.getElementById('manualScanModal');
  const addAdminModal = document.getElementById('addAdminModal');

  // Forms
  const addWorkerForm = document.getElementById('addWorkerForm');
  const editWorkerForm = document.getElementById('editWorkerForm');
  const manualScanForm = document.getElementById('manualScanForm');
  const addAdminForm = document.getElementById('addAdminForm');

  // Search & Filter Inputs
  const workerSearchInput = document.getElementById('workerSearchInput');
  const workerStatusFilter = document.getElementById('workerStatusFilter');
  const logsSearchInput = document.getElementById('logsSearchInput');
  const logsDirectionFilter = document.getElementById('logsDirectionFilter');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const currentPageNum = document.getElementById('currentPageNum');
  const paginationInfo = document.getElementById('paginationInfo');

  // Buttons
  const addWorkerModalBtn = document.getElementById('addWorkerModalBtn');
  const manualScanModalBtn = document.getElementById('manualScanModalBtn');
  const addAdminModalBtn = document.getElementById('addAdminModalBtn');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const quickAddWorkerBtn = document.getElementById('quickAddWorkerBtn');
  const quickManualPunchBtn = document.getElementById('quickManualPunchBtn');
  const quickExportBtn = document.getElementById('quickExportBtn');
  const viewAllLogsBtn = document.getElementById('viewAllLogsBtn');
  const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleApiKeyVisibility = document.getElementById('toggleApiKeyVisibility');

  // -------------------------------------------------------------------
  // Helper Functions
  // -------------------------------------------------------------------
  function getHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (state.sessionToken) {
      headers['X-Session-Token'] = state.sessionToken;
    }
    if (state.apiKey) {
      headers['X-Device-Token'] = state.apiKey;
    }
    return headers;
  }

  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✅' : '⚠️'}</span>
      <div>${message}</div>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function formatDate(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return date.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function formatTime(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function updateClock() {
    const now = new Date();
    currentTimeEl.textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  setInterval(updateClock, 1000);
  updateClock();

  // -------------------------------------------------------------------
  // Authentication Logic
  // -------------------------------------------------------------------
  function checkAuthStatus() {
    if (state.sessionToken) {
      loginOverlay.classList.remove('active');
      loggedInUsername.textContent = state.username || 'Admin';
      switchTab(state.activeTab || 'dashboard');
    } else {
      loginOverlay.classList.add('active');
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUsername.value.trim();
    const password = loginPassword.value;

    loginErrorMsg.textContent = '';

    try {
      const res = await fetch('/api/v1/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const result = await res.json();
      if (res.ok && result.status === 'success') {
        state.sessionToken = result.token;
        state.username = result.username;
        localStorage.setItem('pdks_session_token', result.token);
        localStorage.setItem('pdks_username', result.username);

        loginOverlay.classList.remove('active');
        loggedInUsername.textContent = result.username;
        showToast(`Welcome back, ${result.username}!`, 'success');
        switchTab('dashboard');
      } else {
        loginErrorMsg.textContent = result.message || 'Invalid username or password';
      }
    } catch (err) {
      loginErrorMsg.textContent = 'Server connection error';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/v1/admin/logout', { method: 'POST', headers: getHeaders() });
    } catch (err) {
      console.warn('Logout error:', err);
    }

    state.sessionToken = '';
    localStorage.removeItem('pdks_session_token');
    showToast('Logged out successfully', 'success');
    loginOverlay.classList.add('active');
  });

  // -------------------------------------------------------------------
  // Tab Navigation Handler
  // -------------------------------------------------------------------
  function switchTab(tabId) {
    state.activeTab = tabId;

    navItems.forEach(item => {
      if (item.dataset.tab === tabId) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    tabViews.forEach(view => {
      if (view.id === `view-${tabId}`) {
        view.classList.add('active');
      } else {
        view.classList.remove('active');
      }
    });

    // Update Header titles
    switch (tabId) {
      case 'dashboard':
        pageTitle.textContent = 'System Overview';
        pageSubTitle.textContent = 'Real-time attendance & RFID access monitor';
        loadDashboardData();
        break;
      case 'workers':
        pageTitle.textContent = 'Worker Database';
        pageSubTitle.textContent = 'Manage registered worker profiles, active status & card access';
        loadWorkersData();
        break;
      case 'logs':
        pageTitle.textContent = 'Attendance Logs';
        pageSubTitle.textContent = 'Real-time and historical scan events';
        loadLogsData();
        break;
      case 'accounts':
        pageTitle.textContent = 'Admin User Accounts';
        pageSubTitle.textContent = 'Register and manage system entrance credentials';
        loadAdminAccountsData();
        break;
      case 'settings':
        pageTitle.textContent = 'System Settings';
        pageSubTitle.textContent = 'Configure API token authorization & scanner settings';
        break;
    }
  }

  navItems.forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab));
  });

  // -------------------------------------------------------------------
  // API Fetchers
  // -------------------------------------------------------------------

  // 1. Dashboard Stats
  async function loadDashboardData() {
    try {
      const res = await fetch('/api/v1/admin/stats', { headers: getHeaders() });
      if (res.status === 401) {
        state.sessionToken = '';
        localStorage.removeItem('pdks_session_token');
        loginOverlay.classList.add('active');
        return;
      }
      if (!res.ok) throw new Error('API request failed');

      const result = await res.json();
      if (result.status === 'success') {
        const { total_workers, scans_today, currently_present, active_devices, recent_scans, unknown_scans } = result.data;

        document.getElementById('statTotalWorkers').textContent = total_workers || 0;
        document.getElementById('statScansToday').textContent = scans_today || 0;
        document.getElementById('statPresent').textContent = currently_present || 0;
        document.getElementById('statActiveDevices').textContent = active_devices || 0;

        renderRecentScansFeed(recent_scans);
        if (unknown_scans) renderUnknownCardAlerts(unknown_scans);
        setServerOnline(true);
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
      setServerOnline(false);
    }
  }

  // Unknown Card Scans Alerts
  async function loadUnknownCardAlerts() {
    try {
      const res = await fetch('/api/v1/admin/unknown-scans', { headers: getHeaders() });
      if (!res.ok) return;
      const result = await res.json();
      if (result.status === 'success') {
        renderUnknownCardAlerts(result.data);
      }
    } catch (err) {
      console.error('Failed to fetch unknown card alerts:', err);
    }
  }

  function renderUnknownCardAlerts(unknownScans) {
    const container = document.getElementById('unknownAlertsContainer');
    if (!container) return;

    if (!unknownScans || unknownScans.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = unknownScans.map(scan => {
      return `
        <div class="unknown-card-alert" id="alert-unk-${scan.card_id}">
          <div class="unknown-alert-info">
            <div class="unknown-alert-badge-icon">⚠️</div>
            <div class="unknown-alert-text">
              <h4>Unregistered RFID Card Scanned!</h4>
              <p>Card UID: <span class="card-id-highlight">${scan.card_id}</span> &bull; Scanned at ${formatTime(scan.timestamp)} from Scanner ${scan.serial} (${scan.ip})</p>
            </div>
          </div>
          <div class="unknown-alert-actions">
            <button class="btn btn-sm btn-primary quick-register-unk-btn" data-card="${scan.card_id}">Register Worker</button>
            <button class="btn btn-sm btn-secondary dismiss-unk-btn" data-card="${scan.card_id}">&times; Dismiss</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach listeners for register and dismiss buttons
    document.querySelectorAll('.quick-register-unk-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card_id = e.currentTarget.dataset.card;
        switchTab('workers');
        document.getElementById('newCardId').value = card_id;
        openModal(addWorkerModal);
      });
    });

    document.querySelectorAll('.dismiss-unk-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const card_id = e.currentTarget.dataset.card;
        await dismissUnknownCardAlert(card_id);
      });
    });
  }

  async function dismissUnknownCardAlert(card_id) {
    try {
      const res = await fetch(`/api/v1/admin/unknown-scans/${encodeURIComponent(card_id)}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (res.ok) {
        showToast(`Dismissed unknown card notification (${card_id})`, 'success');
        loadUnknownCardAlerts();
      }
    } catch (err) {
      console.error('Failed to dismiss unknown card alert:', err);
    }
  }

  function renderRecentScansFeed(scans) {
    const container = document.getElementById('recentScansFeed');
    if (!scans || scans.length === 0) {
      container.innerHTML = '<div class="empty-state">No attendance scan activity recorded yet.</div>';
      return;
    }

    container.innerHTML = scans.map(scan => {
      const isCheckIn = scan.direction && scan.direction.toUpperCase() === 'IN';
      const workerName = scan.name ? `${scan.name} ${scan.surname || ''}` : 'Unknown Worker';
      const avatarInitial = scan.name ? scan.name[0].toUpperCase() : '?';

      return `
        <div class="feed-item">
          <div class="feed-worker">
            <div class="feed-avatar">${avatarInitial}</div>
            <div class="feed-details">
              <h4>${workerName}</h4>
              <span>Card: ${scan.card_id}</span>
            </div>
          </div>
          <div class="feed-meta">
            <span class="badge ${isCheckIn ? 'badge-in' : 'badge-out'}">${scan.direction || 'SCAN'}</span>
            <span class="time-stamp">${formatTime(scan.scanned_at)}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. Workers List
  async function loadWorkersData() {
    const searchVal = workerSearchInput.value.trim();
    const statusVal = workerStatusFilter ? workerStatusFilter.value : 'ALL';

    let query = `?search=${encodeURIComponent(searchVal)}&status=${encodeURIComponent(statusVal)}`;

    try {
      const res = await fetch(`/api/v1/admin/workers${query}`, { headers: getHeaders() });
      if (!res.ok) throw new Error('Failed to fetch workers');

      const result = await res.json();
      if (result.status === 'success') {
        state.workersCache = result.data;
        renderWorkersTable(result.data);
        populateManualScanWorkerDropdown(result.data);
        setServerOnline(true);
      }
    } catch (err) {
      console.error('Workers fetch error:', err);
      document.getElementById('workersTableBody').innerHTML = `
        <tr><td colspan="6" class="table-loading text-rose">Error loading workers list. Check API Connection.</td></tr>
      `;
      setServerOnline(false);
    }
  }

  function renderWorkersTable(workers) {
    const tbody = document.getElementById('workersTableBody');
    if (!workers || workers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No workers found matching the current criteria. Click "Add Worker" to register one.</td></tr>';
      return;
    }

    tbody.innerHTML = workers.map(worker => {
      const isPassive = (worker.status || 'ACTIVE').toUpperCase() === 'PASSIVE';
      const isPresent = worker.last_direction && worker.last_direction.toUpperCase() === 'IN';

      const accountStatusBadge = isPassive ? 
        `<span class="badge badge-passive">PASSIVE (Disabled)</span>` : 
        `<span class="badge badge-active">ACTIVE</span>`;

      const presenceBadge = worker.last_direction ? 
        `<span class="badge ${isPresent ? 'badge-in' : 'badge-out'}">${isPresent ? 'PRESENT (IN)' : 'OUT'}</span>` : 
        `<span class="badge badge-card">No Activity</span>`;

      const toggleActionBtn = isPassive ?
        `<button class="btn btn-sm btn-secondary toggle-status-btn" data-card="${worker.card_id}" data-target-status="ACTIVE">Activate</button>` :
        `<button class="btn btn-sm btn-warning toggle-status-btn" data-card="${worker.card_id}" data-target-status="PASSIVE">Deactivate</button>`;

      return `
        <tr class="${isPassive ? 'row-passive' : ''}">
          <td><strong>${worker.name} ${worker.surname}</strong></td>
          <td><span class="badge-card">${worker.card_id}</span></td>
          <td>${accountStatusBadge}</td>
          <td>${presenceBadge}</td>
          <td>${formatDate(worker.last_scanned_at)}</td>
          <td class="text-right">
            <button class="btn btn-sm btn-secondary edit-worker-btn" data-card="${worker.card_id}" data-name="${worker.name}" data-surname="${worker.surname}" data-status="${worker.status || 'ACTIVE'}">Edit</button>
            ${toggleActionBtn}
          </td>
        </tr>
      `;
    }).join('');

    // Attach row button events
    document.querySelectorAll('.edit-worker-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const { card, name, surname, status } = e.currentTarget.dataset;
        openEditWorkerModal(card, name, surname, status);
      });
    });

    document.querySelectorAll('.toggle-status-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const { card, targetStatus } = e.currentTarget.dataset;
        toggleWorkerStatus(card, targetStatus);
      });
    });
  }

  // 3. Attendance Logs List
  async function loadLogsData() {
    const searchVal = logsSearchInput.value.trim();
    const directionVal = logsDirectionFilter.value;
    const page = state.logsCurrentPage;
    const limit = state.logsLimit;

    let queryParams = `?page=${page}&limit=${limit}`;
    if (searchVal) queryParams += `&search=${encodeURIComponent(searchVal)}`;
    if (directionVal && directionVal !== 'ALL') queryParams += `&direction=${encodeURIComponent(directionVal)}`;

    try {
      const res = await fetch(`/api/v1/admin/attendance${queryParams}`, { headers: getHeaders() });
      if (!res.ok) throw new Error('Failed to fetch attendance logs');

      const result = await res.json();
      if (result.status === 'success') {
        renderLogsTable(result.data);
        updatePaginationUI(result.pagination);
        setServerOnline(true);
      }
    } catch (err) {
      console.error('Logs fetch error:', err);
      document.getElementById('logsTableBody').innerHTML = `
        <tr><td colspan="7" class="table-loading text-rose">Error loading attendance logs. Check API Connection.</td></tr>
      `;
      setServerOnline(false);
    }
  }

  function renderLogsTable(logs) {
    const tbody = document.getElementById('logsTableBody');
    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No attendance logs found matching current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(log => {
      const isCheckIn = log.direction && log.direction.toUpperCase() === 'IN';
      const isPassive = (log.worker_status || 'ACTIVE').toUpperCase() === 'PASSIVE';
      
      let workerName = log.worker_name ? `${log.worker_name} ${log.worker_surname || ''}` : '<span class="text-dim">Unregistered</span>';
      if (isPassive) {
        workerName += ' <span class="badge badge-passive" style="font-size:0.65rem; padding:0.1rem 0.4rem;">PASSIVE</span>';
      }

      return `
        <tr>
          <td>#${log.id}</td>
          <td>${formatDate(log.scanned_at)}</td>
          <td><strong>${workerName}</strong></td>
          <td><span class="badge-card">${log.card_id}</span></td>
          <td><span class="badge ${isCheckIn ? 'badge-in' : 'badge-out'}">${log.direction}</span></td>
          <td>${log.device_serial || '—'}</td>
          <td>${log.ip_address || '—'}</td>
        </tr>
      `;
    }).join('');
  }

  function updatePaginationUI(pagination) {
    state.logsTotalPages = pagination.totalPages;
    currentPageNum.textContent = `Page ${pagination.page} of ${pagination.totalPages}`;
    paginationInfo.textContent = `Showing ${pagination.data ? pagination.data.length : 0} of ${pagination.total} logs`;

    prevPageBtn.disabled = pagination.page <= 1;
    nextPageBtn.disabled = pagination.page >= pagination.totalPages;
  }

  // 4. Registered Admin Accounts Management
  async function loadAdminAccountsData() {
    try {
      const res = await fetch('/api/v1/admin/accounts', { headers: getHeaders() });
      if (!res.ok) throw new Error('Failed to fetch admin accounts');

      const result = await res.json();
      if (result.status === 'success') {
        renderAccountsTable(result.data);
      }
    } catch (err) {
      console.error('Admin accounts fetch error:', err);
      document.getElementById('accountsTableBody').innerHTML = `
        <tr><td colspan="4" class="table-loading text-rose">Error loading admin accounts list.</td></tr>
      `;
    }
  }

  function renderAccountsTable(accounts) {
    const tbody = document.getElementById('accountsTableBody');
    if (!accounts || accounts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No admin accounts registered.</td></tr>';
      return;
    }

    tbody.innerHTML = accounts.map(acc => {
      const isCurrent = acc.username === state.username;
      const deleteBtn = accounts.length > 1 ? 
        `<button class="btn btn-sm btn-danger delete-admin-btn" data-id="${acc.id}" data-username="${acc.username}">Remove Account</button>` : 
        `<span class="text-dim" style="font-size:0.78rem;">Primary Account</span>`;

      return `
        <tr>
          <td>#${acc.id}</td>
          <td><strong>${acc.username}</strong> ${isCurrent ? '<span class="badge badge-active" style="font-size:0.65rem; margin-left:0.5rem;">YOU</span>' : ''}</td>
          <td>${formatDate(acc.created_at)}</td>
          <td class="text-right">
            ${deleteBtn}
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('.delete-admin-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const { id, username } = e.currentTarget.dataset;
        deleteAdminAccount(id, username);
      });
    });
  }

  // Add Admin Form Submit
  addAdminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('newAdminUsername').value.trim();
    const password = document.getElementById('newAdminPassword').value;

    try {
      const res = await fetch('/api/v1/admin/accounts', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ username, password })
      });

      const result = await res.json();
      if (res.ok && result.status === 'success') {
        showToast(`Admin account '${username}' registered successfully!`, 'success');
        closeModal(addAdminModal);
        addAdminForm.reset();
        loadAdminAccountsData();
      } else {
        showToast(result.message || 'Failed to register admin account', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  });

  // Delete Admin Account
  async function deleteAdminAccount(id, username) {
    if (!confirm(`Are you sure you want to remove admin account '${username}'?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/admin/accounts/${id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });

      const result = await res.json();
      if (res.ok && result.status === 'success') {
        showToast(`Admin account '${username}' removed`, 'success');
        loadAdminAccountsData();
      } else {
        showToast(result.message || 'Failed to remove admin account', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  }

  function setServerOnline(isOnline) {
    if (isOnline) {
      serverStatusPill.className = 'server-status-pill online';
      serverStatusText.textContent = 'System Connected';
    } else {
      serverStatusPill.className = 'server-status-pill offline';
      serverStatusText.textContent = 'Connection Error';
    }
  }

  // -------------------------------------------------------------------
  // Worker CRUD & Status Toggle Handlers
  // -------------------------------------------------------------------

  // Add Worker Form Submit
  addWorkerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const card_id = document.getElementById('newCardId').value.trim();
    const name = document.getElementById('newName').value.trim();
    const surname = document.getElementById('newSurname').value.trim();
    const status = document.getElementById('newStatus').value;

    try {
      const res = await fetch('/api/v1/admin/workers', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ card_id, name, surname, status })
      });

      const result = await res.json();
      if (res.ok && result.status === 'success') {
        showToast(`Worker ${name} ${surname} registered as ${status}!`, 'success');
        closeModal(addWorkerModal);
        addWorkerForm.reset();
        loadWorkersData();
        loadDashboardData();
      } else {
        showToast(result.message || 'Failed to register worker', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  });

  // Open Edit Worker Modal
  function openEditWorkerModal(card_id, name, surname, status) {
    document.getElementById('editCardId').value = card_id;
    document.getElementById('editName').value = name;
    document.getElementById('editSurname').value = surname;
    document.getElementById('editStatus').value = status || 'ACTIVE';
    openModal(editWorkerModal);
  }

  // Edit Worker Form Submit
  editWorkerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const card_id = document.getElementById('editCardId').value;
    const name = document.getElementById('editName').value.trim();
    const surname = document.getElementById('editSurname').value.trim();
    const status = document.getElementById('editStatus').value;

    try {
      const res = await fetch(`/api/v1/admin/workers/${encodeURIComponent(card_id)}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ name, surname, status })
      });

      const result = await res.json();
      if (res.ok && result.status === 'success') {
        showToast(`Worker updated successfully!`, 'success');
        closeModal(editWorkerModal);
        loadWorkersData();
        loadDashboardData();
      } else {
        showToast(result.message || 'Failed to update worker', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  });

  // Toggle Worker Status (ACTIVE <-> PASSIVE)
  async function toggleWorkerStatus(card_id, targetStatus) {
    const actionText = targetStatus === 'PASSIVE' ? 'deactivate (disable card access for)' : 'activate';
    if (!confirm(`Are you sure you want to ${actionText} worker with Card ID '${card_id}'?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/admin/workers/${encodeURIComponent(card_id)}/status`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ status: targetStatus })
      });

      const result = await res.json();
      if (res.ok && result.status === 'success') {
        showToast(`Worker card status changed to ${targetStatus}`, 'success');
        loadWorkersData();
        loadDashboardData();
      } else {
        showToast(result.message || 'Failed to update worker status', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  }

  // -------------------------------------------------------------------
  // Manual Attendance Punch Handler
  // -------------------------------------------------------------------
  function populateManualScanWorkerDropdown(workers) {
    const select = document.getElementById('manualCardId');
    select.innerHTML = '<option value="">Select worker...</option>';
    workers.forEach(w => {
      const isPassive = (w.status || 'ACTIVE').toUpperCase() === 'PASSIVE';
      if (isPassive) {
        select.innerHTML += `<option value="${w.card_id}" disabled>${w.name} ${w.surname} (${w.card_id}) - [PASSIVE - Disabled]</option>`;
      } else {
        select.innerHTML += `<option value="${w.card_id}">${w.name} ${w.surname} (${w.card_id})</option>`;
      }
    });
  }

  manualScanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const card_id = document.getElementById('manualCardId').value;
    const direction = document.getElementById('manualDirection').value;

    try {
      const res = await fetch('/api/v1/admin/attendance/manual', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ card_id, direction })
      });

      const result = await res.json();
      if (res.ok && result.status === 'success') {
        showToast(result.message || `Logged manual ${direction} punch!`, 'success');
        closeModal(manualScanModal);
        manualScanForm.reset();
        if (state.activeTab === 'logs') loadLogsData();
        loadDashboardData();
        if (state.activeTab === 'workers') loadWorkersData();
      } else {
        showToast(result.message || 'Failed to submit attendance log', 'error');
      }
    } catch (err) {
      showToast('Server communication error', 'error');
    }
  });

  // Export CSV Handler
  function exportCsvLogs() {
    window.location.href = '/api/v1/admin/attendance/export';
  }
  exportCsvBtn.addEventListener('click', exportCsvLogs);
  quickExportBtn.addEventListener('click', exportCsvLogs);

  // -------------------------------------------------------------------
  // Search & Pagination Listeners
  // -------------------------------------------------------------------
  let workerSearchTimeout;
  workerSearchInput.addEventListener('input', () => {
    clearTimeout(workerSearchTimeout);
    workerSearchTimeout = setTimeout(loadWorkersData, 300);
  });

  if (workerStatusFilter) {
    workerStatusFilter.addEventListener('change', loadWorkersData);
  }

  let logsSearchTimeout;
  logsSearchInput.addEventListener('input', () => {
    clearTimeout(logsSearchTimeout);
    state.logsCurrentPage = 1;
    logsSearchTimeout = setTimeout(loadLogsData, 300);
  });

  logsDirectionFilter.addEventListener('change', () => {
    state.logsCurrentPage = 1;
    loadLogsData();
  });

  prevPageBtn.addEventListener('click', () => {
    if (state.logsCurrentPage > 1) {
      state.logsCurrentPage--;
      loadLogsData();
    }
  });

  nextPageBtn.addEventListener('click', () => {
    if (state.logsCurrentPage < state.logsTotalPages) {
      state.logsCurrentPage++;
      loadLogsData();
    }
  });

  // Quick Action Buttons
  addWorkerModalBtn.addEventListener('click', () => openModal(addWorkerModal));
  if (addAdminModalBtn) {
    addAdminModalBtn.addEventListener('click', () => openModal(addAdminModal));
  }
  quickAddWorkerBtn.addEventListener('click', () => {
    switchTab('workers');
    openModal(addWorkerModal);
  });

  manualScanModalBtn.addEventListener('click', () => openModal(manualScanModal));
  quickManualPunchBtn.addEventListener('click', () => openModal(manualScanModal));

  viewAllLogsBtn.addEventListener('click', () => switchTab('logs'));

  // -------------------------------------------------------------------
  // Settings API Key Controls
  // -------------------------------------------------------------------
  if (state.apiKey) {
    apiKeyInput.value = state.apiKey;
  }

  saveApiKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    state.apiKey = key;
    localStorage.setItem('pdks_api_key', key);
    showToast('API Key token saved to browser settings', 'success');
  });

  toggleApiKeyVisibility.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleApiKeyVisibility.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleApiKeyVisibility.textContent = 'Show';
    }
  });

  // Global Refresh Button
  globalRefreshBtn.addEventListener('click', () => {
    loadUnknownCardAlerts();
    if (state.activeTab === 'dashboard') loadDashboardData();
    else if (state.activeTab === 'workers') loadWorkersData();
    else if (state.activeTab === 'logs') loadLogsData();
    else if (state.activeTab === 'accounts') loadAdminAccountsData();
    showToast('Data refreshed', 'success');
  });

  // Auto Refresh Interval Toggle (5 seconds)
  function startAutoRefresh() {
    if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
    state.autoRefreshTimer = setInterval(() => {
      if (state.autoRefresh && state.sessionToken) {
        loadUnknownCardAlerts();
        if (state.activeTab === 'dashboard') loadDashboardData();
        else if (state.activeTab === 'workers') loadWorkersData();
        else if (state.activeTab === 'logs') loadLogsData();
        else if (state.activeTab === 'accounts') loadAdminAccountsData();
      }
    }, 5000);
  }

  autoRefreshToggle.addEventListener('change', (e) => {
    state.autoRefresh = e.target.checked;
    showToast(state.autoRefresh ? 'Live 5s sync enabled' : 'Live sync paused', 'success');
  });

  startAutoRefresh();

  // -------------------------------------------------------------------
  // Modal Helpers
  // -------------------------------------------------------------------
  function openModal(modal) {
    modal.classList.add('active');
  }

  function closeModal(modal) {
    modal.classList.remove('active');
  }

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.close;
      closeModal(document.getElementById(modalId));
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal && modal.id !== 'loginOverlay') closeModal(modal);
    });
  });

  // Initial Load Check
  checkAuthStatus();
});
