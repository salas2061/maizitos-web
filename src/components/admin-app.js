import { api } from '../api/client.js';
import { formatPrice, today } from '../utils/date.js';
import { escapeHtml } from '../utils/html.js';

const sessionKey = 'maizitos_admin_session';

function formatDateTime(value) {
  if (!value) return 'Nunca';
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey));
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(sessionKey, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(sessionKey);
}

export async function renderAdminApp(root, content) {
  root.innerHTML = `
    <main class="admin-app">
      <section class="auth-screen" id="auth-screen">
        <div class="auth-visual">
          <a class="brand auth-brand" href="/" aria-label="${content.brand}">
            <span class="brand-mark">M</span>
            <span>${content.brand}</span>
          </a>
          <div>
            <p>Panel seguro</p>
            <h1>Gestión del restaurante</h1>
            <span>Reservas, carta, disponibilidad y usuarios en un solo lugar.</span>
          </div>
        </div>

        <section class="auth-card" id="login-card" hidden>
          <p>Acceso administrativo</p>
          <h2>Inicia sesión</h2>
          <form class="auth-form" id="login-form">
            <label class="field">
              <span>Usuario</span>
              <input name="username" autocomplete="username" required />
            </label>
            <label class="field">
              <span>Contraseña</span>
              <input name="password" type="password" autocomplete="current-password" required />
            </label>
            <button class="primary-action" type="submit">Entrar</button>
            <p class="form-status" id="login-status" role="status"></p>
          </form>
        </section>

        <section class="auth-card" id="setup-card" hidden>
          <p>Primer acceso</p>
          <h2>Crea el superusuario único</h2>
          <form class="auth-form" id="setup-form">
            <label class="field">
              <span>Nombre</span>
              <input name="name" autocomplete="name" required />
            </label>
            <label class="field">
              <span>Usuario</span>
              <input name="username" autocomplete="username" required placeholder="superadmin" />
            </label>
            <label class="field">
              <span>Correo</span>
              <input name="email" type="email" autocomplete="email" />
            </label>
            <label class="field">
              <span>Contraseña</span>
              <input name="password" type="password" autocomplete="new-password" required />
            </label>
            <label class="field">
              <span>Confirmar contraseña</span>
              <input name="confirmPassword" type="password" autocomplete="new-password" required />
            </label>
            <button class="primary-action" type="submit">Crear superusuario</button>
            <p class="form-status" id="setup-status" role="status"></p>
          </form>
        </section>
      </section>

      <section class="dashboard-shell" id="dashboard-shell" hidden></section>
    </main>
  `;

  const authScreen = root.querySelector('#auth-screen');
  const loginCard = root.querySelector('#login-card');
  const setupCard = root.querySelector('#setup-card');
  const loginForm = root.querySelector('#login-form');
  const setupForm = root.querySelector('#setup-form');
  const loginStatus = root.querySelector('#login-status');
  const setupStatus = root.querySelector('#setup-status');
  const dashboardShell = root.querySelector('#dashboard-shell');

  let session = readSession();
  let token = session?.token || '';
  let currentUser = null;
  let reservations = [];
  let dishes = [];
  let availability = {};
  let users = [];
  let passwordRequests = [];

  async function bootstrap() {
    try {
      const status = await api.authStatus();

      if (token && !status.setupRequired) {
        try {
          currentUser = await api.me(token);
          await showDashboard();
          return;
        } catch {
          clearSession();
          token = '';
        }
      }

      setupCard.hidden = !status.setupRequired;
      loginCard.hidden = status.setupRequired;
    } catch (error) {
      loginCard.hidden = false;
      loginStatus.textContent = `No se pudo conectar con la API: ${error.message}`;
    }
  }

  function setSession(authResponse) {
    token = authResponse.token;
    currentUser = authResponse.user;
    saveSession(authResponse);
  }

  async function showDashboard() {
    authScreen.hidden = true;
    dashboardShell.hidden = false;
    dashboardShell.innerHTML = dashboardTemplate();
    bindDashboardEvents();
    await loadDashboardData();
    showView('overview');
  }

  function dashboardTemplate() {
    const usersNav = currentUser.role === 'superuser'
      ? '<button class="side-link" type="button" data-view="users">Usuarios</button>'
      : '';

    const usersSection = currentUser.role === 'superuser' ? usersTemplate() : '';

    return `
      <aside class="dashboard-sidebar">
        <a class="brand dashboard-brand" href="/" aria-label="${content.brand}">
          <span class="brand-mark">M</span>
          <span>${content.brand}</span>
        </a>
        <nav class="side-nav" aria-label="Panel administrativo">
          <button class="side-link is-active" type="button" data-view="overview">Resumen</button>
          <button class="side-link" type="button" data-view="reservations">Reservas</button>
          <button class="side-link" type="button" data-view="menu">Carta</button>
          <button class="side-link" type="button" data-view="availability">Disponibilidad</button>
          ${usersNav}
          <button class="side-link" type="button" data-view="security">Seguridad</button>
        </nav>
        <a class="public-link" href="/">Ver web pública</a>
      </aside>

      <section class="dashboard-main">
        <header class="dashboard-topbar">
          <div>
            <p>Panel del dueño</p>
            <h1>Administración</h1>
          </div>
          <div class="user-chip">
            <span>${escapeHtml(currentUser.name || currentUser.username)}</span>
            <strong>${currentUser.role === 'superuser' ? 'Superusuario' : 'Admin'}</strong>
            <button class="ghost-button" type="button" id="logout-button">Salir</button>
          </div>
        </header>

        <div class="dashboard-alert" id="dashboard-alert" hidden></div>

        <section class="dashboard-view is-visible" data-section="overview">
          <div class="metric-grid">
            <article class="metric-card">
              <span>Reservas</span>
              <strong id="metric-reservations">0</strong>
            </article>
            <article class="metric-card">
              <span>Platos</span>
              <strong id="metric-dishes">0</strong>
            </article>
            <article class="metric-card">
              <span>Fechas con carta</span>
              <strong id="metric-dates">0</strong>
            </article>
            <article class="metric-card">
              <span>Rol activo</span>
              <strong>${currentUser.role === 'superuser' ? 'Super' : 'Admin'}</strong>
            </article>
          </div>
          <section class="admin-panel welcome-panel">
            <p>Operación diaria</p>
            <h2>Controla reservas, carta y disponibilidad sin salir del panel.</h2>
          </section>
        </section>

        <section class="dashboard-view" data-section="reservations">
          <section class="admin-panel">
            <div class="panel-heading">
              <div>
                <p>Reservas</p>
                <h2>Reservas realizadas</h2>
              </div>
              <button class="ghost-button" type="button" id="refresh-dashboard">Actualizar</button>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Fecha</th>
                    <th>Hora</th>
                    <th>Personas</th>
                    <th>Contacto</th>
                    <th>Correo</th>
                    ${currentUser.role === 'superuser' ? '<th>Acciones</th>' : ''}
                  </tr>
                </thead>
                <tbody id="reservations-table"></tbody>
              </table>
            </div>
          </section>
        </section>

        <section class="dashboard-view" data-section="menu">
          <section class="admin-panel">
            <div class="panel-heading">
              <div>
                <p>Carta</p>
                <h2>Platos del restaurante</h2>
              </div>
            </div>
            <form class="form-grid admin-form" id="dish-form">
              <input name="id" type="hidden" />
              <label class="field">
                <span>Nombre</span>
                <input name="name" required />
              </label>
              <label class="field">
                <span>Categoría</span>
                <input name="category" required />
              </label>
              <label class="field">
                <span>Precio</span>
                <input name="price" type="number" min="0" step="0.1" required />
              </label>
              <label class="field field-wide">
                <span>Descripción</span>
                <textarea name="description" rows="3"></textarea>
              </label>
              <label class="check-field">
                <input name="active" type="checkbox" checked />
                <span>Plato activo</span>
              </label>
              <button class="primary-action" type="submit">Guardar plato</button>
            </form>
            <div class="dish-list admin-list" id="admin-dishes"></div>
          </section>
        </section>

        <section class="dashboard-view" data-section="availability">
          <section class="admin-panel">
            <div class="panel-heading">
              <div>
                <p>Disponibilidad</p>
                <h2>Platos por fecha</h2>
              </div>
            </div>
            <label class="field inline-field">
              <span>Fecha</span>
              <input id="admin-date" type="date" value="${today()}" />
            </label>
            <div class="availability-editor" id="availability-editor"></div>
            <button class="primary-action" id="save-availability" type="button">Guardar disponibilidad</button>
            <p class="form-status" id="admin-status" role="status"></p>
          </section>
        </section>

        ${usersSection}

        <section class="dashboard-view" data-section="security">
          <section class="admin-panel security-panel">
            <div class="panel-heading">
              <div>
                <p>Seguridad</p>
                <h2>Cambio de contraseña</h2>
              </div>
            </div>
            <form class="form-grid admin-form" id="password-form">
              <label class="field">
                <span>Contraseña actual</span>
                <input name="currentPassword" type="password" autocomplete="current-password" required />
              </label>
              <label class="field">
                <span>Nueva contraseña</span>
                <input name="newPassword" type="password" autocomplete="new-password" required />
              </label>
              <label class="field">
                <span>Confirmar nueva contraseña</span>
                <input name="confirmPassword" type="password" autocomplete="new-password" required />
              </label>
              <button class="primary-action" type="submit">Solicitar cambio</button>
              <p class="form-status field-wide" id="password-status" role="status"></p>
            </form>
          </section>
        </section>
      </section>
    `;
  }

  function usersTemplate() {
    return `
      <section class="dashboard-view" data-section="users">
        <section class="admin-panel">
          <div class="panel-heading">
            <div>
              <p>Superusuario</p>
              <h2>Usuarios y aprobaciones</h2>
            </div>
          </div>
          <div class="users-grid">
            <form class="admin-form user-create-form" id="user-form">
              <h3>Crear cuenta admin</h3>
              <label class="field">
                <span>Nombre</span>
                <input name="name" required />
              </label>
              <label class="field">
                <span>Usuario</span>
                <input name="username" required />
              </label>
              <label class="field">
                <span>Correo</span>
                <input name="email" type="email" />
              </label>
              <label class="field">
                <span>Contraseña temporal</span>
                <input name="password" type="password" required />
              </label>
              <button class="primary-action" type="submit">Crear usuario</button>
              <p class="form-status" id="user-status" role="status"></p>
            </form>
            <div class="approval-box">
              <h3>Solicitudes de contraseña</h3>
              <div id="password-requests"></div>
            </div>
          </div>
          <div class="table-wrap user-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Estado</th>
                  <th>Último acceso</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody id="users-table"></tbody>
            </table>
          </div>
        </section>
      </section>
    `;
  }

  function bindDashboardEvents() {
    dashboardShell.querySelector('#logout-button').addEventListener('click', () => {
      clearSession();
      window.location.reload();
    });

    dashboardShell.querySelectorAll('[data-view]').forEach((button) => {
      button.addEventListener('click', () => showView(button.dataset.view));
    });

    dashboardShell.querySelector('#refresh-dashboard')?.addEventListener('click', loadDashboardData);
    dashboardShell.querySelector('#reservations-table').addEventListener('click', handleReservationAction);
    dashboardShell.querySelector('#dish-form').addEventListener('submit', saveDish);
    dashboardShell.querySelector('#admin-dishes').addEventListener('click', handleDishAction);
    dashboardShell.querySelector('#admin-date').addEventListener('change', renderAvailability);
    dashboardShell.querySelector('#save-availability').addEventListener('click', saveAvailabilityForDate);
    dashboardShell.querySelector('#password-form').addEventListener('submit', submitPasswordChange);

    if (currentUser.role === 'superuser') {
      dashboardShell.querySelector('#user-form').addEventListener('submit', createUser);
      dashboardShell.querySelector('#users-table').addEventListener('click', handleUserAction);
      dashboardShell.querySelector('#password-requests').addEventListener('click', handlePasswordRequestAction);
    }
  }

  function showView(view) {
    dashboardShell.querySelectorAll('[data-section]').forEach((section) => {
      section.classList.toggle('is-visible', section.dataset.section === view);
    });

    dashboardShell.querySelectorAll('[data-view]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.view === view);
    });
  }

  function setAlert(message, isError = false) {
    const alert = dashboardShell.querySelector('#dashboard-alert');
    alert.hidden = false;
    alert.textContent = message;
    alert.classList.toggle('is-error', isError);
  }

  async function loadDashboardData() {
    try {
      const requests = [api.adminReservations(token), api.adminDishes(token), api.adminAvailability(token)];
      const [nextReservations, nextDishes, nextAvailability] = await Promise.all(requests);
      reservations = nextReservations;
      dishes = nextDishes;
      availability = nextAvailability;

      if (currentUser.role === 'superuser') {
        const userData = await api.adminUsers(token);
        users = userData.users;
        passwordRequests = userData.passwordRequests;
        renderUsers();
      }

      renderOverview();
      renderReservations();
      renderDishes();
      renderAvailability();
    } catch (error) {
      setAlert(error.message, true);
    }
  }

  function renderOverview() {
    dashboardShell.querySelector('#metric-reservations').textContent = reservations.length;
    dashboardShell.querySelector('#metric-dishes').textContent = dishes.length;
    dashboardShell.querySelector('#metric-dates').textContent = Object.keys(availability).length;
  }

  function renderReservations() {
    const table = dashboardShell.querySelector('#reservations-table');
    const canDeleteReservations = currentUser.role === 'superuser';
    const emptyColspan = canDeleteReservations ? 7 : 6;

    table.innerHTML = reservations.length
      ? reservations
          .map(
            (reservation) => {
              const emailStatus = {
                sent: 'Enviado',
                failed: 'Falló',
                simulated: 'Simulado'
              }[reservation.emailDeliveryStatus] || 'Sin dato';
              const emailStatusClass = reservation.emailDeliveryStatus || 'unknown';

              return `
              <tr>
                <td>
                  <strong>${escapeHtml(reservation.name)}</strong>
                  <span>${escapeHtml(reservation.notes || 'Sin notas')}</span>
                </td>
                <td>${escapeHtml(reservation.date)}</td>
                <td>${escapeHtml(reservation.time)}</td>
                <td>${escapeHtml(reservation.guests)}</td>
                <td>${escapeHtml(reservation.email)}<br />${escapeHtml(reservation.phone)}</td>
                <td>
                  <span class="status-pill ${escapeHtml(emailStatusClass)}">${escapeHtml(emailStatus)}</span>
                  ${
                    reservation.emailDeliveryError
                      ? `<span>${escapeHtml(reservation.emailDeliveryError)}</span>`
                      : ''
                  }
                </td>
                ${
                  canDeleteReservations
                    ? `<td>
                        <button
                          class="table-action-button is-danger"
                          type="button"
                          data-delete-reservation="${escapeHtml(reservation.id)}"
                          aria-label="Eliminar reserva de ${escapeHtml(reservation.name)}"
                        >
                          Eliminar
                        </button>
                      </td>`
                    : ''
                }
              </tr>
            `;
            }
          )
          .join('')
      : `<tr><td colspan="${emptyColspan}">Sin reservas registradas.</td></tr>`;
  }

  function renderDishes() {
    const list = dashboardShell.querySelector('#admin-dishes');
    list.innerHTML = dishes
      .map(
        (dish) => `
          <article class="menu-item compact">
            <span>${escapeHtml(dish.category)} · ${dish.active ? 'Activo' : 'Inactivo'}</span>
            <div>
              <h3>${escapeHtml(dish.name)}</h3>
              <p>${escapeHtml(dish.description)}</p>
            </div>
            <strong>${formatPrice(dish.price)}</strong>
            <div class="row-actions">
              <button type="button" data-edit="${escapeHtml(dish.id)}">Editar</button>
              <button type="button" data-delete="${escapeHtml(dish.id)}">Eliminar</button>
            </div>
          </article>
        `
      )
      .join('');
  }

  function renderAvailability() {
    const selectedDate = dashboardShell.querySelector('#admin-date').value;
    const selected = availability[selectedDate] || [];
    dashboardShell.querySelector('#availability-editor').innerHTML = dishes
      .map(
        (dish) => `
          <label class="check-field availability-pill">
            <input type="checkbox" value="${escapeHtml(dish.id)}" ${selected.includes(dish.id) ? 'checked' : ''} />
            <span>${escapeHtml(dish.name)}</span>
          </label>
        `
      )
      .join('');
  }

  function renderUsers() {
    dashboardShell.querySelector('#users-table').innerHTML = users
      .map(
        (user) => `
          <tr>
            <td>
              <strong>${escapeHtml(user.name || user.username)}</strong>
              <span>${escapeHtml(user.username)} · ${escapeHtml(user.email || 'Sin correo')}</span>
            </td>
            <td>${user.role === 'superuser' ? 'Superusuario' : 'Admin'}</td>
            <td>${user.active ? 'Activo' : 'Inactivo'}</td>
            <td>${formatDateTime(user.lastLoginAt)}</td>
            <td>
              ${
                user.role === 'superuser'
                  ? '<span>Protegido</span>'
                  : `<button class="ghost-button compact-button" type="button" data-toggle-user="${escapeHtml(user.id)}" data-active="${user.active ? 'false' : 'true'}">${user.active ? 'Desactivar' : 'Activar'}</button>`
              }
            </td>
          </tr>
        `
      )
      .join('');

    const pendingRequests = passwordRequests.filter((request) => request.status === 'pending');
    dashboardShell.querySelector('#password-requests').innerHTML = pendingRequests.length
      ? pendingRequests
          .map(
            (request) => `
              <article class="request-card">
                <div>
                  <strong>${escapeHtml(request.username)}</strong>
                  <span>${formatDateTime(request.requestedAt)}</span>
                </div>
                <div class="row-actions">
                  <button type="button" data-approve-request="${escapeHtml(request.id)}">Aprobar</button>
                  <button type="button" data-reject-request="${escapeHtml(request.id)}">Rechazar</button>
                </div>
              </article>
            `
          )
          .join('')
      : '<p class="muted">No hay solicitudes pendientes.</p>';
  }

  async function saveDish(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form));
    payload.active = form.elements.active.checked;
    const id = payload.id;
    delete payload.id;

    try {
      if (id) {
        await api.updateDish(token, id, payload);
      } else {
        await api.createDish(token, payload);
      }

      form.reset();
      form.elements.active.checked = true;
      await loadDashboardData();
      setAlert('Plato guardado correctamente.');
    } catch (error) {
      setAlert(error.message, true);
    }
  }

  async function handleDishAction(event) {
    const editId = event.target.dataset.edit;
    const deleteId = event.target.dataset.delete;
    const form = dashboardShell.querySelector('#dish-form');

    if (editId) {
      const dish = dishes.find((item) => item.id === editId);
      form.elements.id.value = dish.id;
      form.elements.name.value = dish.name;
      form.elements.category.value = dish.category;
      form.elements.price.value = dish.price;
      form.elements.description.value = dish.description;
      form.elements.active.checked = dish.active;
      showView('menu');
    }

    if (deleteId && window.confirm('¿Eliminar este plato de la carta?')) {
      await api.deleteDish(token, deleteId);
      await loadDashboardData();
      setAlert('Plato eliminado.');
    }
  }

  async function handleReservationAction(event) {
    const deleteId = event.target.dataset.deleteReservation;

    if (!deleteId || currentUser.role !== 'superuser') {
      return;
    }

    const reservation = reservations.find((item) => item.id === deleteId);
    const customerName = reservation?.name || 'esta reserva';

    if (!window.confirm(`¿Eliminar la reserva de ${customerName}? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await api.deleteReservation(token, deleteId);
      await loadDashboardData();
      setAlert('Reserva eliminada.');
    } catch (error) {
      setAlert(error.message, true);
    }
  }

  async function saveAvailabilityForDate() {
    const selectedDate = dashboardShell.querySelector('#admin-date').value;
    const checked = [...dashboardShell.querySelectorAll('#availability-editor input:checked')].map((input) => input.value);

    try {
      await api.updateAvailability(token, selectedDate, checked);
      await loadDashboardData();
      dashboardShell.querySelector('#admin-status').textContent = `Disponibilidad guardada para ${selectedDate}.`;
    } catch (error) {
      dashboardShell.querySelector('#admin-status').textContent = error.message;
    }
  }

  async function createUser(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = dashboardShell.querySelector('#user-status');

    try {
      await api.createUser(token, Object.fromEntries(new FormData(form)));
      form.reset();
      status.textContent = 'Usuario creado correctamente.';
      await loadDashboardData();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function handleUserAction(event) {
    const userId = event.target.dataset.toggleUser;
    if (!userId) return;

    try {
      await api.updateUserStatus(token, userId, event.target.dataset.active === 'true');
      await loadDashboardData();
    } catch (error) {
      setAlert(error.message, true);
    }
  }

  async function handlePasswordRequestAction(event) {
    const approveId = event.target.dataset.approveRequest;
    const rejectId = event.target.dataset.rejectRequest;

    try {
      if (approveId) {
        await api.approvePasswordRequest(token, approveId);
      }

      if (rejectId) {
        await api.rejectPasswordRequest(token, rejectId);
      }

      await loadDashboardData();
    } catch (error) {
      setAlert(error.message, true);
    }
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const status = dashboardShell.querySelector('#password-status');
    const payload = Object.fromEntries(new FormData(form));

    if (payload.newPassword !== payload.confirmPassword) {
      status.textContent = 'Las contraseñas nuevas no coinciden.';
      return;
    }

    try {
      const result = await api.requestPasswordChange(token, payload);
      form.reset();
      status.textContent =
        result.status === 'applied'
          ? 'Contraseña actualizada.'
          : 'Solicitud enviada. El superusuario debe aprobarla.';
    } catch (error) {
      status.textContent = error.message;
    }
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginStatus.textContent = 'Validando credenciales...';

    try {
      const authResponse = await api.login(Object.fromEntries(new FormData(loginForm)));
      setSession(authResponse);
      await showDashboard();
    } catch (error) {
      loginStatus.textContent = error.message;
    }
  });

  setupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setupStatus.textContent = 'Creando superusuario...';
    const payload = Object.fromEntries(new FormData(setupForm));

    if (payload.password !== payload.confirmPassword) {
      setupStatus.textContent = 'Las contraseñas no coinciden.';
      return;
    }

    try {
      const authResponse = await api.setupSuperuser(payload);
      setSession(authResponse);
      await showDashboard();
    } catch (error) {
      setupStatus.textContent = error.message;
    }
  });

  await bootstrap();
}
