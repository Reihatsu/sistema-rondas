import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";

import {
  Avatar,
  Badge,
  ConfirmDialog,
  EmptyState,
  ErrorAlert,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  Spinner,
  cn,
} from "../components/ui";
import { usersApi, companiesApi, getErrorMessage } from "../services/api";
import { ROLE_LABELS, formatDate } from "../utils/format";

const ROLE_TONES = {
  ADMIN: "purple",
  SUPERVISOR: "info",
  COMPANY_USER: "warning",
  GUARD: "success",
};

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Administrador" },
  { value: "SUPERVISOR", label: "Supervisor" },
  { value: "GUARD", label: "Guardia" },
  { value: "COMPANY_USER", label: "Usuario de empresa" },
];

const EMPTY_FORM = {
  name: "",
  email: "",
  password: "",
  role: "GUARD",
  is_active: true,
  company_ids: [],
  supervisor_ids: [],
};

export default function Users() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");

  const [allUsers, setAllUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [supervisorGuards, setSupervisorGuards] = useState({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [openingId, setOpeningId] = useState(null);

  const [assignTarget, setAssignTarget] = useState(null);
  const [assignSelected, setAssignSelected] = useState([]);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState("");

  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const loadTable = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { page, page_size: pageSize };
      if (search) params.search = search;
      if (roleFilter) params.role = roleFilter;
      if (activeFilter) params.is_active = activeFilter === "active";
      const data = await usersApi.list(params);
      setItems(data.items);
      setTotal(data.total);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter, activeFilter]);

  const loadCatalogs = useCallback(async () => {
    try {
      const [users, companyList] = await Promise.all([
        usersApi.listAll(),
        companiesApi.listAll(),
      ]);
      setAllUsers(users);
      setCompanies(companyList);

      const supervisors = users.filter((user) => user.role === "SUPERVISOR");
      const entries = await Promise.all(
        supervisors.map(async (supervisor) => [
          supervisor.id,
          await usersApi.listGuards(supervisor.id),
        ]),
      );
      setSupervisorGuards(Object.fromEntries(entries));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  }, []);

  useEffect(() => {
    loadTable();
  }, [loadTable]);

  useEffect(() => {
    loadCatalogs();
  }, [loadCatalogs]);

  const allGuards = useMemo(
    () => allUsers.filter((user) => user.role === "GUARD"),
    [allUsers],
  );
  const allSupervisors = useMemo(
    () => allUsers.filter((user) => user.role === "SUPERVISOR"),
    [allUsers],
  );
  const supervisorsByGuard = useMemo(() => {
    const map = {};
    Object.entries(supervisorGuards).forEach(([supervisorId, guards]) => {
      const supervisor = allUsers.find(
        (user) => user.id === Number(supervisorId),
      );
      guards.forEach((guard) => {
        if (!map[guard.id]) map[guard.id] = [];
        if (supervisor) map[guard.id].push(supervisor);
      });
    });
    return map;
  }, [supervisorGuards, allUsers]);

  async function refreshAll() {
    await Promise.all([loadTable(), loadCatalogs()]);
  }

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  }

  async function openEdit(user) {
    setOpeningId(user.id);
    setFormError("");
    try {
      const detail = await usersApi.get(user.id);
      setEditing(detail);
      setForm({
        name: detail.name,
        email: detail.email,
        password: "",
        role: detail.role,
        is_active: detail.is_active,
        company_ids: (detail.companies || []).map((company) => company.id),
        supervisor_ids: (detail.supervisors || []).map((supervisor) => supervisor.id),
      });
      setModalOpen(true);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setOpeningId(null);
    }
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }

  function toggleFormId(field, id) {
    setForm((prev) => ({
      ...prev,
      [field]: prev[field].includes(id)
        ? prev[field].filter((value) => value !== id)
        : [...prev[field], id],
    }));
  }

  function handleRoleChange(role) {
    setForm((prev) => ({
      ...prev,
      role,
      supervisor_ids: role === "GUARD" ? prev.supervisor_ids : [],
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role,
      is_active: form.is_active,
      company_ids: form.company_ids,
    };
    if (form.password.trim()) payload.password = form.password;
    if (form.role === "GUARD") payload.supervisor_ids = form.supervisor_ids;

    try {
      if (editing) {
        await usersApi.update(editing.id, payload);
        setNotice("Usuario actualizado correctamente.");
        await refreshAll();
      } else {
        await usersApi.create({
          ...payload,
          password: form.password,
          supervisor_ids: form.role === "GUARD" ? form.supervisor_ids : [],
        });
        setNotice("Usuario creado correctamente.");
        setPage(1);
        await refreshAll();
      }
      setModalOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (requestError) {
      setFormError(getErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function openAssign(supervisor) {
    setOpeningId(`assign-${supervisor.id}`);
    setAssignError("");
    try {
      const guards = await usersApi.listGuards(supervisor.id);
      setAssignTarget(supervisor);
      setAssignSelected(guards.map((guard) => guard.id));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setOpeningId(null);
    }
  }

  function toggleAssign(guardId) {
    setAssignSelected((prev) =>
      prev.includes(guardId)
        ? prev.filter((value) => value !== guardId)
        : [...prev, guardId],
    );
  }

  async function saveAssignments() {
    if (!assignTarget) return;
    setAssignBusy(true);
    setAssignError("");
    try {
      const currentIds = new Set(
        (supervisorGuards[assignTarget.id] || []).map((guard) => guard.id),
      );
      const selectedIds = new Set(assignSelected);
      const toAdd = assignSelected.filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !selectedIds.has(id));

      await Promise.all([
        ...toAdd.map((guardId) =>
          usersApi.assignGuard(assignTarget.id, guardId),
        ),
        ...toRemove.map((guardId) =>
          usersApi.unassignGuard(assignTarget.id, guardId),
        ),
      ]);

      setNotice(`Guardias actualizados para ${assignTarget.name}.`);
      setAssignTarget(null);
      setAssignSelected([]);
      await Promise.all([loadCatalogs(), loadTable()]);
    } catch (requestError) {
      setAssignError(getErrorMessage(requestError));
    } finally {
      setAssignBusy(false);
    }
  }

  async function toggleActive() {
    if (!confirm) return;
    setConfirmBusy(true);
    setError("");
    try {
      await usersApi.update(confirm.id, { is_active: !confirm.is_active });
      setNotice(
        confirm.is_active
          ? `El usuario ${confirm.name} fue desactivado.`
          : `El usuario ${confirm.name} fue reactivado.`,
      );
      setConfirm(null);
      await refreshAll();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setConfirm(null);
    } finally {
      setConfirmBusy(false);
    }
  }


  return (
    <div className="space-y-4">
      <PageHeader
        icon={UsersRound}
        title="Usuarios"
        description={
          total > 0
            ? `${total} usuario${total === 1 ? "" : "s"} con acceso al sistema.`
            : "Administre accesos, roles y asignaciones operativas."
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={refreshAll}
              disabled={loading}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                aria-hidden="true"
              />
              Actualizar
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
              <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Nuevo usuario
            </button>
          </>
        }
      />

      <Notice tone="success" onClose={() => setNotice("")}>
        {notice}
      </Notice>
      <ErrorAlert message={error} onRetry={refreshAll} />

      <div className="card overflow-hidden">
        <div className="toolbar">
          <form className="relative min-w-0 flex-1 sm:max-w-sm" onSubmit={handleSearch}>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por nombre o correo…"
              className="input pl-9"
              aria-label="Buscar usuarios"
            />
          </form>

          <select
            value={roleFilter}
            onChange={(event) => {
              setPage(1);
              setRoleFilter(event.target.value);
            }}
            className="select sm:w-44"
            aria-label="Filtrar por rol"
          >
            <option value="">Todos los roles</option>
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={activeFilter}
            onChange={(event) => {
              setPage(1);
              setActiveFilter(event.target.value);
            }}
            className="select sm:w-44"
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </select>
        </div>

        {loading ? (
          <Spinner label="Cargando usuarios…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="Sin usuarios"
            description={
              search || roleFilter || activeFilter
                ? "No hay usuarios que coincidan con los filtros seleccionados."
                : "Cree el primer usuario para empezar a operar."
            }
            action={
              <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
                <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                Nuevo usuario
              </button>
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Empresas</th>
                  <th>Supervisión</th>
                  <th>Estado</th>
                  <th className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>

                {items.map((user) => {
                  const guardSupervisors = supervisorsByGuard[user.id] || [];
                  const supervised = supervisorGuards[user.id] || [];
                  const userCompanies = user.companies || [];

                  return (
                    <tr key={user.id}>
                      <td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={user.name} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-slate-800">
                              {user.name}
                            </p>
                            <p className="truncate text-xs text-slate-500">
                              {user.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge tone={ROLE_TONES[user.role] || "neutral"}>
                          {ROLE_LABELS[user.role] || user.role}
                        </Badge>
                      </td>
                      <td>
                        {userCompanies.length > 0 ? (
                          <div className="flex max-w-[230px] flex-wrap gap-1">
                            {userCompanies.slice(0, 2).map((company) => (
                              <span
                                key={company.id}
                                className="chip"
                                title={company.name}
                              >
                                {company.name}
                              </span>
                            ))}
                            {userCompanies.length > 2 ? (
                              <span className="chip">
                                +{userCompanies.length - 2}
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">Sin empresa</span>
                        )}
                      </td>
                      <td>
                        {user.role === "GUARD" ? (
                          guardSupervisors.length > 0 ? (
                            <div className="flex max-w-[220px] flex-wrap gap-1">
                              {guardSupervisors.map((supervisor) => (
                                <span
                                  key={supervisor.id}
                                  className="chip"
                                  title={`Supervisor: ${supervisor.name}`}
                                >
                                  {supervisor.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-amber-600">
                              Sin supervisor
                            </span>
                          )
                        ) : user.role === "SUPERVISOR" ? (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                            <ShieldCheck
                              className="h-3.5 w-3.5 text-odoo-600"
                              aria-hidden="true"
                            />
                            {supervised.length} guardia
                            {supervised.length === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={user.is_active ? "success" : "neutral"}>
                          {user.is_active ? "Activo" : "Inactivo"}
                        </Badge>
                      </td>

                      <td className="cell-actions">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => openEdit(user)}
                            disabled={openingId !== null}
                            title="Editar usuario"
                            aria-label={`Editar ${user.name}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          {user.role === "SUPERVISOR" ? (
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              onClick={() => openAssign(user)}
                              disabled={openingId !== null}
                              title="Asignar guardias"
                              aria-label={`Asignar guardias a ${user.name}`}
                            >
                              <ShieldCheck
                                className="h-4 w-4 text-odoo-600"
                                aria-hidden="true"
                              />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => setConfirm(user)}
                            title={
                              user.is_active
                                ? "Desactivar usuario"
                                : "Reactivar usuario"
                            }
                            aria-label={
                              user.is_active
                                ? `Desactivar ${user.name}`
                                : `Reactivar ${user.name}`
                            }
                          >
                            {user.is_active ? (
                              <PowerOff
                                className="h-4 w-4 text-amber-600"
                                aria-hidden="true"
                              />
                            ) : (
                              <Power
                                className="h-4 w-4 text-emerald-600"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </div>


      {modalOpen ? (
        <Modal
          wide
          icon={editing ? Pencil : UserPlus}
          title={editing ? "Editar usuario" : "Nuevo usuario"}
          subtitle={
            editing
              ? `Alta: ${formatDate(editing.created_at)} · ${editing.email}`
              : "Defina el acceso y las asignaciones del nuevo usuario."
          }
          onClose={closeModal}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeModal}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                form="user-form"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving
                  ? "Guardando…"
                  : editing
                    ? "Guardar cambios"
                    : "Crear usuario"}
              </button>
            </>
          }
        >
          <form id="user-form" className="space-y-5" onSubmit={handleSubmit}>
            <ErrorAlert message={formError} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="user-name" className="label">
                  Nombre completo *
                </label>
                <input
                  id="user-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={150}
                  autoFocus
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="input"
                  placeholder="Ana García"
                />
              </div>
              <div>
                <label htmlFor="user-email" className="label">
                  Correo electrónico *
                </label>
                <input
                  id="user-email"
                  type="email"
                  required
                  maxLength={150}
                  value={form.email}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, email: event.target.value }))
                  }
                  className="input"
                  placeholder="ana@empresa.com"
                />
              </div>
              <div>
                <label htmlFor="user-password" className="label">
                  Contraseña {editing ? "" : "*"}
                </label>
                <div className="relative">
                  <KeyRound
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="user-password"
                    type="password"
                    required={!editing}
                    minLength={8}
                    maxLength={72}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, password: event.target.value }))
                    }
                    className="input pl-9"
                    placeholder={editing ? "Dejar vacío para conservar" : "Mínimo 8 caracteres"}
                  />
                </div>
                {editing ? (
                  <p className="field-hint">
                    Solo rellene este campo si desea cambiar la contraseña.
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="user-role" className="label">
                  Rol *
                </label>
                <select
                  id="user-role"
                  value={form.role}
                  onChange={(event) => handleRoleChange(event.target.value)}
                  className="select"
                >
                  {ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, is_active: event.target.checked }))
                }
              />
              <span>
                <span className="block font-medium text-slate-700">Usuario activo</span>
                <span className="block text-xs text-slate-500">
                  Los usuarios inactivos no pueden iniciar sesión.
                </span>
              </span>
            </label>


            <section className="rounded-lg border border-slate-200 p-3.5">
              <div className="mb-2.5">
                <h3 className="text-sm font-semibold text-slate-800">
                  Empresas asignadas
                </h3>
                <p className="text-xs text-slate-500">
                  Determine a qué instalaciones puede acceder el usuario.
                </p>
              </div>
              {companies.length === 0 ? (
                <p className="text-xs text-amber-600">
                  No hay empresas registradas. Cree una empresa antes de asignar
                  accesos.
                </p>
              ) : (
                <div className="grid max-h-44 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                  {companies.map((company) => (
                    <label key={company.id} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={form.company_ids.includes(company.id)}
                        onChange={() => toggleFormId("company_ids", company.id)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-700">
                          {company.name}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          {company.tax_id}
                          {company.is_active ? "" : " · Inactiva"}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            {form.role === "GUARD" ? (
              <section className="rounded-lg border border-slate-200 p-3.5">
                <div className="mb-2.5">
                  <h3 className="text-sm font-semibold text-slate-800">
                    Supervisores a cargo
                  </h3>
                  <p className="text-xs text-slate-500">
                    El guardia aparecerá en la vista agrupada de cada supervisor
                    seleccionado.
                  </p>
                </div>
                {allSupervisors.length === 0 ? (
                  <p className="text-xs text-amber-600">
                    No hay supervisores creados. Puede asignarlos más adelante.
                  </p>
                ) : (
                  <div className="grid max-h-40 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {allSupervisors.map((supervisor) => (
                      <label key={supervisor.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={form.supervisor_ids.includes(supervisor.id)}
                          onChange={() =>
                            toggleFormId("supervisor_ids", supervisor.id)
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-700">
                            {supervisor.name}
                          </span>
                          <span className="block truncate text-[10px] text-slate-400">
                            {supervisor.email}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </form>
        </Modal>
      ) : null}


      {assignTarget ? (
        <Modal
          wide
          icon={ShieldCheck}
          title={`Guardias de ${assignTarget.name}`}
          subtitle="Marque los guardias que reportan a este supervisor."
          onClose={() => {
            if (!assignBusy) {
              setAssignTarget(null);
              setAssignSelected([]);
            }
          }}
          footer={
            <>
              <span className="mr-auto text-xs text-slate-500">
                {assignSelected.length} seleccionado
                {assignSelected.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setAssignTarget(null);
                  setAssignSelected([]);
                }}
                disabled={assignBusy}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={saveAssignments}
                disabled={assignBusy}
              >
                {assignBusy ? "Guardando…" : "Guardar asignación"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <ErrorAlert message={assignError} />
            {allGuards.length === 0 ? (
              <EmptyState
                icon={UsersRound}
                title="Sin guardias disponibles"
                description="Cree usuarios con rol Guardia para poder asignarlos."
              />
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {allGuards.map((guard) => (
                  <label key={guard.id} className="checkbox-row items-start">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={assignSelected.includes(guard.id)}
                      onChange={() => toggleAssign(guard.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-700">
                        {guard.name}
                      </span>
                      <span className="block truncate text-[10px] text-slate-400">
                        {guard.email}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {(guard.companies || []).slice(0, 2).map((company) => (
                          <span key={company.id} className="chip">
                            {company.name}
                          </span>
                        ))}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </Modal>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.is_active ? "Desactivar usuario" : "Reactivar usuario"}
          description={
            confirm.is_active
              ? `El usuario "${confirm.name}" no podrá iniciar sesión. Sus asignaciones y el histórico se conservan.`
              : `El usuario "${confirm.name}" podrá volver a iniciar sesión con sus permisos actuales.`
          }
          confirmLabel={confirm.is_active ? "Desactivar" : "Reactivar"}
          tone={confirm.is_active ? "danger" : "primary"}
          busy={confirmBusy}
          onConfirm={toggleActive}
          onClose={() => {
            if (!confirmBusy) setConfirm(null);
          }}
        />
      ) : null}
    </div>
  );
}

