const configuredApiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, '');
const API_URL = configuredApiUrl || '';

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'No se pudo completar la solicitud');
  }

  return data;
}

export const api = {
  authStatus: () => request('/api/auth/status'),
  setupSuperuser: (payload) => request('/api/auth/setup-superuser', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  me: (token) => request('/api/auth/me', { token }),
  requestPasswordChange: (token, payload) =>
    request('/api/auth/password-change-requests', { method: 'POST', token, body: payload }),
  getMenu: () => request('/api/menu'),
  getAvailability: (date) => request(`/api/availability?date=${date}`),
  createReservation: (payload) => request('/api/reservations', { method: 'POST', body: payload }),
  adminReservations: (token) => request('/api/admin/reservations', { token }),
  deleteReservation: (token, id) => request(`/api/admin/reservations/${id}`, { method: 'DELETE', token }),
  adminDishes: (token) => request('/api/admin/dishes', { token }),
  createDish: (token, payload) => request('/api/admin/dishes', { method: 'POST', token, body: payload }),
  updateDish: (token, id, payload) =>
    request(`/api/admin/dishes/${id}`, { method: 'PUT', token, body: payload }),
  deleteDish: (token, id) => request(`/api/admin/dishes/${id}`, { method: 'DELETE', token }),
  adminAvailability: (token) => request('/api/admin/availability', { token }),
  updateAvailability: (token, date, dishIds) =>
    request(`/api/admin/availability/${date}`, { method: 'PUT', token, body: { dishIds } }),
  adminUsers: (token) => request('/api/admin/users', { token }),
  createUser: (token, payload) => request('/api/admin/users', { method: 'POST', token, body: payload }),
  updateUserStatus: (token, id, active) =>
    request(`/api/admin/users/${id}`, { method: 'PUT', token, body: { active } }),
  approvePasswordRequest: (token, id) =>
    request(`/api/admin/password-requests/${id}/approve`, { method: 'POST', token }),
  rejectPasswordRequest: (token, id) =>
    request(`/api/admin/password-requests/${id}/reject`, { method: 'POST', token })
};
