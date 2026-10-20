import axios from "axios";

export const TOKEN_KEY = "sistema-rondas.token";
export const USER_KEY = "sistema-rondas.user";

// En desarrollo, Vite hace proxy de /api hacia FastAPI (ver vite.config.js).
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api/v1",
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = error.config?.url ?? "";
    // Token caducado/inválido: se cierra la sesión (el login no dispara esto).
    if (status === 401 && !url.includes("/auth/login")) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    return Promise.reject(error);
  },
);

/** Extrae un mensaje legible de un error de Axios/FastAPI. */
export function getErrorMessage(error) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const field = Array.isArray(item.loc) ? item.loc.slice(1).join(".") : "";
        return field ? `${field}: ${item.msg}` : item.msg;
      })
      .join(". ");
  }
  if (error?.code === "ECONNABORTED") {
    return "La petición tardó demasiado. Inténtelo de nuevo.";
  }
  if (!error?.response) {
    return "No se pudo conectar con el servidor. Verifique que la API esté en ejecución.";
  }
  return error.message || "Se produjo un error inesperado.";
}

/**
 * Recorre todas las páginas de un endpoint paginado (máx. 100 por página).
 * Útil para filtros y asignaciones que necesitan el catálogo completo.
 */
export async function fetchAllPages(fetchPage, params = {}) {
  const pageSize = params.page_size || 100;
  const items = [];
  let page = 1;
  let total = Number.POSITIVE_INFINITY;

  while (items.length < total && page <= 50) {
    const data = await fetchPage({ ...params, page, page_size: pageSize });
    const batch = Array.isArray(data?.items) ? data.items : [];
    if (batch.length === 0) break;
    items.push(...batch);
    total = Number.isFinite(data?.total) ? data.total : items.length;
    page += 1;
  }

  return items;
}

export const authApi = {
  login: (email, password) =>
    api.post("/auth/login", { email, password }).then((res) => res.data),
  me: () => api.get("/auth/me").then((res) => res.data),
};

export const companiesApi = {
  list: (params) => api.get("/companies", { params }).then((res) => res.data),
  listAll: (params = {}) =>
    fetchAllPages((query) => companiesApi.list(query), params),
  get: (id) => api.get(`/companies/${id}`).then((res) => res.data),
  create: (payload) => api.post("/companies", payload).then((res) => res.data),
  update: (id, payload) =>
    api.put(`/companies/${id}`, payload).then((res) => res.data),
  remove: (id, hard = false) =>
    api.delete(`/companies/${id}`, { params: { hard } }).then((res) => res.data),
};

export const checkpointsApi = {
  list: (params) => api.get("/checkpoints", { params }).then((res) => res.data),
  listAll: (params = {}) =>
    fetchAllPages((query) => checkpointsApi.list(query), params),
  get: (id) => api.get(`/checkpoints/${id}`).then((res) => res.data),
  create: (payload) =>
    api.post("/checkpoints", payload).then((res) => res.data),
  update: (id, payload) =>
    api.put(`/checkpoints/${id}`, payload).then((res) => res.data),
  remove: (id) => api.delete(`/checkpoints/${id}`).then((res) => res.data),
};

export const usersApi = {
  list: (params) => api.get("/users", { params }).then((res) => res.data),
  listAll: (params = {}) =>
    fetchAllPages((query) => usersApi.list(query), params),
  get: (id) => api.get(`/users/${id}`).then((res) => res.data),
  create: (payload) => api.post("/users", payload).then((res) => res.data),
  update: (id, payload) =>
    api.put(`/users/${id}`, payload).then((res) => res.data),
  remove: (id, hard = false) =>
    api.delete(`/users/${id}`, { params: { hard } }).then((res) => res.data),
  listGuards: (supervisorId) =>
    api.get(`/users/${supervisorId}/guards`).then((res) => res.data),
  assignGuard: (supervisorId, guardId) =>
    api
      .post(`/users/${supervisorId}/guards/${guardId}`)
      .then((res) => res.data),
  unassignGuard: (supervisorId, guardId) =>
    api
      .delete(`/users/${supervisorId}/guards/${guardId}`)
      .then((res) => res.data),
};

export const roundsApi = {
  list: (params) => api.get("/rounds", { params }).then((res) => res.data),
  summary: (params) =>
    api.get("/rounds/summary", { params }).then((res) => res.data),
  get: (id) => api.get(`/rounds/${id}`).then((res) => res.data),
  logs: (id) => api.get(`/rounds/${id}/logs`).then((res) => res.data),
  addComment: (id, comment) =>
    api.post(`/rounds/${id}/comments`, { comment }).then((res) => res.data),
};

export default api;
