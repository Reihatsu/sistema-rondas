import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  Pencil,
  Phone,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
} from "lucide-react";

import {
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
import { useAuth } from "../auth/AuthContext";
import { companiesApi, getErrorMessage } from "../services/api";
import { formatDate } from "../utils/format";

const EMPTY_FORM = {
  name: "",
  tax_id: "",
  address: "",
  phone: "",
  is_active: true,
};

const FILTERS = [
  { value: "", label: "Todas" },
  { value: "active", label: "Activas" },
  { value: "inactive", label: "Inactivas" },
];

export default function Companies() {
  const { hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [confirm, setConfirm] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { page, page_size: pageSize };
      if (search) params.search = search;
      if (activeFilter) params.is_active = activeFilter === "active";
      const data = await companiesApi.list(params);
      setItems(data.items);
      setTotal(data.total);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [page, search, activeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function changeFilter(value) {
    setPage(1);
    setActiveFilter(value);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(company) {
    setEditing(company);
    setForm({
      name: company.name,
      tax_id: company.tax_id,
      address: company.address || "",
      phone: company.phone || "",
      is_active: company.is_active,
    });
    setFormError("");
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    const payload = {
      name: form.name.trim(),
      tax_id: form.tax_id.trim(),
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
    };

    try {
      if (editing) {
        await companiesApi.update(editing.id, {
          ...payload,
          is_active: form.is_active,
        });
        setNotice("Empresa actualizada correctamente.");
        await load();
      } else {
        await companiesApi.create({ ...payload, is_active: form.is_active });
        setNotice("Empresa creada correctamente.");
        setPage(1);
        if (page === 1) await load();
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

  async function toggleActive() {
    if (!confirm) return;
    setConfirmBusy(true);
    setError("");
    try {
      await companiesApi.update(confirm.id, { is_active: !confirm.is_active });
      setNotice(
        confirm.is_active
          ? "Empresa desactivada. El histórico se conserva."
          : "Empresa reactivada correctamente.",
      );
      setConfirm(null);
      await load();
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
        icon={Building2}
        title="Empresas"
        description={
          total > 0
            ? `${total} empresa${total === 1 ? "" : "s"} en la cartera de clientes.`
            : "Cartera de clientes e instalaciones vigiladas."
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", loading && "animate-spin")}
                aria-hidden="true"
              />
              Actualizar
            </button>
            {isAdmin ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Nueva empresa
              </button>
            ) : null}
          </>
        }
      />

      <Notice tone="success" onClose={() => setNotice("")}>
        {notice}
      </Notice>
      <ErrorAlert message={error} onRetry={load} />

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
              placeholder="Buscar por nombre, NIF o dirección…"
              className="input pl-9"
              aria-label="Buscar empresas"
            />
          </form>

          <div className="flex flex-wrap items-center gap-1 rounded-md bg-slate-100 p-0.5">
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => changeFilter(filter.value)}
                className={cn(
                  "rounded px-2.5 py-1.5 text-xs font-semibold transition",
                  activeFilter === filter.value
                    ? "bg-white text-odoo-700 shadow-sm"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <Spinner label="Cargando empresas…" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Sin empresas"
            description={
              search || activeFilter
                ? "No hay empresas que coincidan con los filtros seleccionados."
                : "Cree la primera empresa para empezar a registrar rondas."
            }
            action={
              isAdmin ? (
                <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Nueva empresa
                </button>
              ) : null
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>NIF/CIF</th>
                  <th>Contacto</th>
                  <th>Estado</th>
                  <th>Creada</th>
                  {isAdmin ? <th className="text-right">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>

                {items.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-odoo-50 text-odoo-700">
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-800">
                            {company.name}
                          </p>
                          <p className="text-[11px] text-slate-400">ID #{company.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{company.tax_id}</td>
                    <td>
                      <div className="space-y-0.5 text-xs text-slate-500">
                        <p className="max-w-[220px] truncate">
                          {company.address || "Sin dirección"}
                        </p>
                        {company.phone ? (
                          <p className="flex items-center gap-1">
                            <Phone className="h-3 w-3" aria-hidden="true" />
                            {company.phone}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <Badge tone={company.is_active ? "success" : "neutral"}>
                        {company.is_active ? "Activa" : "Inactiva"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">
                      {formatDate(company.created_at)}
                    </td>
                    {isAdmin ? (
                      <td className="cell-actions">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => openEdit(company)}
                            title="Editar empresa"
                            aria-label={`Editar ${company.name}`}
                          >
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => setConfirm(company)}
                            title={
                              company.is_active
                                ? "Desactivar empresa"
                                : "Reactivar empresa"
                            }
                            aria-label={
                              company.is_active
                                ? `Desactivar ${company.name}`
                                : `Reactivar ${company.name}`
                            }
                          >
                            {company.is_active ? (
                              <PowerOff className="h-4 w-4 text-amber-600" aria-hidden="true" />
                            ) : (
                              <Power className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
      </div>


      {modalOpen ? (
        <Modal
          icon={Building2}
          title={editing ? "Editar empresa" : "Nueva empresa"}
          subtitle="El nombre y el NIF/CIF deben ser únicos."
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
                form="company-form"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? "Guardando…" : editing ? "Guardar cambios" : "Crear empresa"}
              </button>
            </>
          }
        >
          <form id="company-form" className="space-y-4" onSubmit={handleSubmit}>
            <ErrorAlert message={formError} />
            <div>
              <label htmlFor="company-name" className="label">
                Nombre de la empresa *
              </label>
              <input
                id="company-name"
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
                placeholder="Vigilancia Norte S.A."
              />
            </div>

            <div>
              <label htmlFor="company-tax-id" className="label">
                NIF/CIF *
              </label>
              <input
                id="company-tax-id"
                type="text"
                required
                minLength={3}
                maxLength={30}
                value={form.tax_id}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, tax_id: event.target.value }))
                }
                className="input font-mono"
                placeholder="B12345678"
              />
            </div>

            <div>
              <label htmlFor="company-address" className="label">
                Dirección
              </label>
              <input
                id="company-address"
                type="text"
                maxLength={255}
                value={form.address}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, address: event.target.value }))
                }
                className="input"
                placeholder="Calle, número, ciudad"
              />
            </div>

            <div>
              <label htmlFor="company-phone" className="label">
                Teléfono
              </label>
              <input
                id="company-phone"
                type="tel"
                maxLength={30}
                value={form.phone}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, phone: event.target.value }))
                }
                className="input"
                placeholder="+34 900 000 000"
              />
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
                <span className="block font-medium text-slate-700">Empresa activa</span>
                <span className="block text-xs text-slate-500">
                  Las empresas inactivas no aparecen en nuevas asignaciones.
                </span>
              </span>
            </label>
          </form>
        </Modal>
      ) : null}

      {confirm ? (
        <ConfirmDialog
          title={confirm.is_active ? "Desactivar empresa" : "Reactivar empresa"}
          description={
            confirm.is_active
              ? `La empresa "${confirm.name}" quedará inactiva. Las rondas y el histórico se conservan, pero no podrá asignarse a nuevos usuarios.`
              : `La empresa "${confirm.name}" volverá a estar disponible para asignaciones y operaciones.`
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

