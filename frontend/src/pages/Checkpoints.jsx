import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  MapPin,
  Nfc,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Printer,
  QrCode,
  RefreshCw,
  Search,
} from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";

import { useAuth } from "../auth/AuthContext";
import {
  Badge,
  ConfirmDialog,
  ErrorAlert,
  Modal,
  Notice,
  PageHeader,
  Pagination,
  cn,
} from "../components/ui";
import { checkpointsApi, companiesApi, getErrorMessage } from "../services/api";
import { POINT_TYPE_LABELS, formatDate } from "../utils/format";

const PAGE_SIZE = 10;
const DEFAULT_GEOFENCE_METERS = 50;
const EMPTY_FORM = {
  company_id: "",
  name: "",
  code: "",
  uid_nfc: "",
  location_description: "",
  latitude: "",
  longitude: "",
  geofence_radius_m: String(DEFAULT_GEOFENCE_METERS),
  is_active: true,
};

/** Canoniza el UID igual que el backend: mayúsculas y sin separadores. */
function normalizeNfcUid(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

/**
 * Tecnología real del punto.
 *
 * La empresa es la autoridad: un punto NFC puede no tener UID todavía y aun así
 * no debe ofrecer código QR. El código interno (`NFC-…`) se usa solo como
 * respaldo para datos antiguos que no traen la relación de empresa.
 */
function pointTypeOf(checkpoint) {
  const companyType = checkpoint?.company?.point_type;
  if (companyType === "NFC" || companyType === "QR") return companyType;

  const explicitType = checkpoint?.point_type;
  if (explicitType === "NFC" || explicitType === "QR") return explicitType;

  return String(checkpoint?.code || "").trim().toUpperCase().startsWith("NFC-")
    ? "NFC"
    : "QR";
}

/** Convierte un número del formulario a ``number | null``. */
function toNumberOrNull(value) {
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function fileSafeCode(code) {
  return String(code || "punto-control").replace(/[^a-z0-9_-]+/gi, "_");
}

export default function Checkpoints() {
  const { hasRole } = useAuth();
  const canManage = hasRole("ADMIN", "SUPERVISOR");
  const isCompanyUser = hasRole("COMPANY_USER");

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [companies, setCompanies] = useState([]);
  const [companiesError, setCompaniesError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [toggleTarget, setToggleTarget] = useState(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  const [qrTarget, setQrTarget] = useState(null);
  const [qrError, setQrError] = useState("");
  const qrCanvasRef = useRef(null);

  // La empresa seleccionada define la tecnología del punto: QR (código
  // impreso) o NFC (etiqueta física con UID).
  const selectedCompany = companies.find(
    (company) => String(company.id) === form.company_id,
  );
  const pointType =
    selectedCompany?.point_type || editing?.company?.point_type || "QR";
  const isNfcPoint = pointType === "NFC";
  const codePlaceholder = `${pointType}-EMP${form.company_id || "ID"}-PT01`;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = { page, page_size: PAGE_SIZE };
      if (search) params.search = search;
      if (companyFilter) params.company_id = Number(companyFilter);
      if (activeFilter) params.is_active = activeFilter === "active";
      const data = await checkpointsApi.list(params);
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [page, search, companyFilter, activeFilter]);

  const loadCompanies = useCallback(async () => {
    setCompaniesError("");
    try {
      const list = await companiesApi.listAll();
      setCompanies(list);
    } catch (requestError) {
      setCompaniesError(getErrorMessage(requestError));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadCompanies();
  }, [loadCompanies]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > totalPages) setPage(totalPages);
  }, [page, total]);

  function handleSearch(event) {
    event.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  }

  function resetFilters() {
    setSearchInput("");
    setSearch("");
    setCompanyFilter("");
    setActiveFilter("");
    setPage(1);
  }

  function openCreate() {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      company_id: companies.length === 1 ? String(companies[0].id) : "",
    });
    setFormError("");
    setModalOpen(true);
  }

  function openEdit(checkpoint) {
    setEditing(checkpoint);
    setForm({
      company_id: String(checkpoint.company_id),
      name: checkpoint.name,
      code: checkpoint.code,
      uid_nfc: checkpoint.uid_nfc || "",
      location_description: checkpoint.location_description || "",
      latitude:
        checkpoint.latitude === null || checkpoint.latitude === undefined
          ? ""
          : String(checkpoint.latitude),
      longitude:
        checkpoint.longitude === null || checkpoint.longitude === undefined
          ? ""
          : String(checkpoint.longitude),
      geofence_radius_m: String(
        checkpoint.geofence_radius_m ?? DEFAULT_GEOFENCE_METERS,
      ),
      is_active: checkpoint.is_active,
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
    if (!form.company_id) {
      setFormError("Seleccione la empresa propietaria del punto.");
      return;
    }

    const uidNfc = normalizeNfcUid(form.uid_nfc);

    const latitude = toNumberOrNull(form.latitude);
    const longitude = toNumberOrNull(form.longitude);
    if ((latitude === null) !== (longitude === null)) {
      setFormError(
        "Indique latitud y longitud juntas, o deje ambas coordenadas vacías.",
      );
      return;
    }

    const radius = toNumberOrNull(form.geofence_radius_m);

    setSaving(true);
    setFormError("");
    const payload = {
      company_id: Number(form.company_id),
      name: form.name.trim(),
      location_description: form.location_description.trim() || null,
      // Las coordenadas solo aplican a puntos QR; en NFC se envían vacías.
      latitude: isNfcPoint ? null : latitude,
      longitude: isNfcPoint ? null : longitude,
      geofence_radius_m: radius ?? DEFAULT_GEOFENCE_METERS,
      uid_nfc: isNfcPoint ? uidNfc : null,
    };

    // El código es opcional: al dejarlo vacío el servidor asigna el siguiente
    // disponible (QR-EMP1-PT01 / NFC-EMP2-PT01). Al editar se conserva el actual.
    const code = form.code.trim().toUpperCase();
    if (code) {
      payload.code = code;
    } else if (!editing) {
      payload.code = null;
    }

    try {
      if (editing) {
        await checkpointsApi.update(editing.id, {
          ...payload,
          is_active: form.is_active,
        });
        setNotice("Punto de control actualizado correctamente.");
        await load();
      } else {
        await checkpointsApi.create({ ...payload, is_active: form.is_active });
        setNotice("Punto de control creado correctamente.");
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
    if (!toggleTarget) return;
    setToggleBusy(true);
    setError("");
    try {
      await checkpointsApi.update(toggleTarget.id, {
        is_active: !toggleTarget.is_active,
      });
      setNotice(
        toggleTarget.is_active
          ? "Punto de control desactivado. Se conserva para el histórico."
          : "Punto de control reactivado correctamente.",
      );
      setToggleTarget(null);
      await load();
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setToggleTarget(null);
    } finally {
      setToggleBusy(false);
    }
  }

  function openQr(checkpoint) {
    // Los puntos NFC no tienen código QR que imprimir, aunque todavía no
    // tengan un UID físico registrado.
    if (pointTypeOf(checkpoint) !== "QR") {
      return;
    }

    setQrTarget(checkpoint);
    setQrError("");
  }

  function getQrDataUrl() {
    const canvas = qrCanvasRef.current?.querySelector("canvas");
    return canvas ? canvas.toDataURL("image/png") : "";
  }

  function handleDownloadQr() {
    const dataUrl = getQrDataUrl();
    if (!dataUrl || !qrTarget) {
      setQrError("No se pudo generar la imagen del código QR.");
      return;
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${fileSafeCode(qrTarget.code)}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function handlePrintQr() {
    const dataUrl = getQrDataUrl();
    if (!dataUrl || !qrTarget) {
      setQrError("No se pudo generar la imagen del código QR.");
      return;
    }

    const printWindow = window.open("", "_blank", "width=560,height=760");
    if (!printWindow) {
      setQrError(
        "El navegador bloqueó la ventana de impresión. Permita las ventanas emergentes para este sitio.",
      );
      return;
    }

    const companyName = qrTarget.company?.name || `Empresa #${qrTarget.company_id}`;
    const html = [
      "<!doctype html><html><head><meta charset='utf-8'>",
      `<title>${escapeHtml(qrTarget.code)} · Punto de Control</title>`,
      "<style>",
      "@page { margin: 18mm; }",
      "* { box-sizing: border-box; }",
      "body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #1e293b; }",
      ".card { border: 2px solid #7c3aed; border-radius: 18px; padding: 28px; text-align: center; }",
      ".brand { color: #6d28d9; font-size: 13px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }",
      "h1 { margin: 18px 0 4px; font-size: 24px; line-height: 1.2; }",
      ".company { margin: 0 0 22px; color: #64748b; font-size: 14px; }",
      "img { width: 280px; height: 280px; display: block; margin: 0 auto; }",
      ".code { margin: 20px auto 8px; display: inline-block; border-radius: 8px; background: #f1f5f9; padding: 8px 16px; font-family: Consolas, monospace; font-size: 18px; font-weight: 700; letter-spacing: .06em; }",
      ".hint { margin: 18px 0 0; color: #64748b; font-size: 12px; line-height: 1.5; }",
      "</style></head><body>",
      "<div class='card'>",
      "<div class='brand'>Sistema de Rondas</div>",
      `<h1>${escapeHtml(qrTarget.name)}</h1>`,
      `<p class='company'>${escapeHtml(companyName)}</p>`,
      `<img src="${dataUrl}" alt="Código QR ${escapeHtml(qrTarget.code)}" onload="window.focus(); setTimeout(function(){ window.print(); }, 180);">`,
      `<div class='code'>${escapeHtml(qrTarget.code)}</div>`,
      "<p class='hint'>Fije este código en la ubicación indicada. El personal de vigilancia lo escaneará al completar la ronda.</p>",
      "</div></body></html>",
    ].join("");

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
  }

  const hasFilters = Boolean(search || companyFilter || activeFilter);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={MapPin}
        title="Puntos de Control"
        description={
          total > 0
            ? `${total} punto${total === 1 ? "" : "s"} de control ${
                isCompanyUser ? "en sus empresas." : "configurados."
              }`
            : isCompanyUser
              ? "Puntos de control de sus empresas (solo lectura)."
              : "Ubicaciones físicas identificadas por QR/NFC para las rondas."
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
            {canManage ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={openCreate}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Nuevo Punto de Control
              </button>
            ) : null}
          </>
        }
      />

      <Notice tone="success" onClose={() => setNotice("")}>
        {notice}
      </Notice>
      <ErrorAlert message={error} onRetry={load} />
      <ErrorAlert message={companiesError} onRetry={loadCompanies} />

      <div className="card overflow-hidden">
        <div className="toolbar">
          <form
            className="relative min-w-0 flex-1 sm:max-w-sm"
            onSubmit={handleSearch}
          >
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar por nombre, código o ubicación…"
              className="input pl-9"
              aria-label="Buscar puntos de control"
            />
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="select w-auto min-w-[190px]"
              value={companyFilter}
              onChange={(event) => {
                setCompanyFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filtrar por empresa"
            >
              <option value="">Todas las empresas</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                  {company.is_active ? "" : " (inactiva)"}
                </option>
              ))}
            </select>
            <select
              className="select w-auto min-w-[145px]"
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value);
                setPage(1);
              }}
              aria-label="Filtrar por estado"
            >
              <option value="">Todos los estados</option>
              <option value="active">Solo activos</option>
              <option value="inactive">Solo inactivos</option>
            </select>
            {hasFilters ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm text-slate-500"
                onClick={resetFilters}
              >
                Limpiar filtros
              </button>
            ) : null}
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Identificador</th>
                <th>Punto de control</th>
                <th>Empresa</th>
                <th>Estado</th>
                <th>Creado</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>
                    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                      <RefreshCw
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                      Cargando puntos de control…
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                      <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                        <MapPin className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <p className="text-sm font-semibold text-slate-700">
                        No se encontraron puntos de control
                      </p>
                      <p className="max-w-md text-xs text-slate-500">
                        Ajuste los filtros o cree un nuevo punto para una de sus
                        empresas.
                      </p>
                      {hasFilters ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm mt-1"
                          onClick={resetFilters}
                        >
                          Ver todos
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((checkpoint) => {
                  const rowPointType = pointTypeOf(checkpoint);

                  return (
                    <tr key={checkpoint.id}>
                    <td>
                      <div className="min-w-[150px]">
                        <span className="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-1 font-mono text-[11px] font-semibold text-slate-700">
                          {rowPointType === "NFC" ? (
                            <Nfc className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            <QrCode className="h-3 w-3" aria-hidden="true" />
                          )}
                          {checkpoint.code}
                        </span>
                        {rowPointType === "NFC" ? (
                          <p
                            className="mt-1 truncate font-mono text-[10px] text-slate-500"
                            title={
                              checkpoint.uid_nfc
                                ? `UID NFC ${checkpoint.uid_nfc}`
                                : "UID NFC pendiente de registrar"
                            }
                          >
                            {checkpoint.uid_nfc
                              ? `UID ${checkpoint.uid_nfc}`
                              : "UID NFC pendiente"}
                          </p>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="min-w-[220px]">
                        <p className="font-semibold text-slate-800">
                          {checkpoint.name}
                        </p>
                        <p className="mt-0.5 max-w-[360px] truncate text-xs text-slate-500">
                          {checkpoint.location_description ||
                            "Sin descripción de ubicación"}
                        </p>
                      </div>
                    </td>
                    <td>
                      <Badge tone="purple">
                        {checkpoint.company?.name ||
                          `Empresa #${checkpoint.company_id}`}
                      </Badge>
                      <span className="mt-1 block text-[10px] uppercase tracking-wide text-slate-400">
                        {POINT_TYPE_LABELS[rowPointType] || rowPointType}
                      </span>
                    </td>
                    <td>
                      <Badge tone={checkpoint.is_active ? "success" : "neutral"}>
                        {checkpoint.is_active ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">
                      {formatDate(checkpoint.created_at)}
                    </td>
                    <td className="cell-actions">
                      <div className="inline-flex items-center gap-1">
                        {rowPointType === "QR" ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            onClick={() => openQr(checkpoint)}
                            title="Ver / imprimir código QR"
                            aria-label={`Ver código QR de ${checkpoint.name}`}
                          >
                            <QrCode className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                        {canManage ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              onClick={() => openEdit(checkpoint)}
                              title="Editar punto de control"
                              aria-label={`Editar ${checkpoint.name}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon"
                              onClick={() => setToggleTarget(checkpoint)}
                              title={
                                checkpoint.is_active
                                  ? "Desactivar punto de control"
                                  : "Reactivar punto de control"
                              }
                              aria-label={
                                checkpoint.is_active
                                  ? `Desactivar ${checkpoint.name}`
                                  : `Reactivar ${checkpoint.name}`
                              }
                            >
                              {checkpoint.is_active ? (
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
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onChange={setPage}
        />
      </div>

      {modalOpen ? (
        <Modal
          icon={MapPin}
          title={editing ? "Editar punto de control" : "Nuevo punto de control"}
          subtitle={
            isNfcPoint
              ? "Esta empresa usa etiquetas NFC: el UID es opcional y puede registrarse ahora o después."
              : "Esta empresa usa códigos QR: puede generar el código y capturar las coordenadas ahora o después."
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
                form="checkpoint-form"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving
                  ? "Guardando…"
                  : editing
                    ? "Guardar cambios"
                    : "Crear punto"}
              </button>
            </>
          }
        >
          <form
            id="checkpoint-form"
            className="space-y-4"
            onSubmit={handleSubmit}
          >
            <ErrorAlert message={formError} />

            <div>
              <label htmlFor="checkpoint-company" className="label">
                Empresa *
              </label>
              <select
                id="checkpoint-company"
                className="select"
                required
                value={form.company_id}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    company_id: event.target.value,
                  }))
                }
              >
                <option value="">Seleccione una empresa…</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                    {company.is_active ? "" : " (inactiva)"}
                  </option>
                ))}
              </select>
              {selectedCompany ? (
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                  {isNfcPoint ? (
                    <Nfc className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {isNfcPoint
                    ? "Puntos con etiqueta NFC: el UID físico es opcional."
                    : "Puntos con código QR: las coordenadas se usan para la geovalla."}
                </p>
              ) : null}
              {companies.length === 0 && !companiesError ? (
                <p className="mt-1 text-xs text-amber-600">
                  No hay empresas asignadas a su usuario.
                </p>
              ) : null}
            </div>

            <div>
              <label htmlFor="checkpoint-name" className="label">
                Nombre del punto *
              </label>
              <input
                id="checkpoint-name"
                type="text"
                required
                minLength={2}
                maxLength={150}
                autoFocus
                value={form.name}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }))
                }
                className="input"
                placeholder="Ej. Entrada Principal"
              />
            </div>

            <div>
              <label htmlFor="checkpoint-code" className="label">
                Código único
              </label>
              <input
                id="checkpoint-code"
                type="text"
                minLength={2}
                maxLength={100}
                value={form.code}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    code: event.target.value
                      .toUpperCase()
                      .replace(/\s+/g, ""),
                  }))
                }
                className="input font-mono uppercase"
                placeholder={codePlaceholder}
                autoComplete="off"
              />
              <p className="mt-1 text-xs text-slate-500">
                {editing
                  ? "Se conserva el código actual si lo deja vacío."
                  : `Opcional: si lo deja vacío, el sistema asigna el siguiente disponible (${codePlaceholder}).`}
              </p>
            </div>

            {isNfcPoint ? (
              <div>
                <label htmlFor="checkpoint-uid" className="label">
                  UID de la etiqueta NFC (opcional)
                </label>
                <input
                  id="checkpoint-uid"
                  type="text"
                  maxLength={100}
                  value={form.uid_nfc}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      uid_nfc: normalizeNfcUid(event.target.value),
                    }))
                  }
                  className="input font-mono uppercase tracking-wider"
                  placeholder="04A23B4C5D6E80"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Opcional: puede completarlo cuando instale la etiqueta. Hex en
                  mayúsculas y sin separadores; se limpian los dos puntos
                  automáticamente. Debe ser único en todo el sistema.
                </p>
              </div>
            ) : null}

            {!isNfcPoint ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="checkpoint-latitude" className="label">
                      Latitud (opcional)
                    </label>
                    <input
                      id="checkpoint-latitude"
                      type="number"
                      step="any"
                      min={-90}
                      max={90}
                      value={form.latitude}
                      onChange={(event) =>
                        setForm((previous) => ({
                          ...previous,
                          latitude: event.target.value,
                        }))
                      }
                      className="input"
                      placeholder="40.4168"
                    />
                  </div>
                  <div>
                    <label htmlFor="checkpoint-longitude" className="label">
                      Longitud (opcional)
                    </label>
                    <input
                      id="checkpoint-longitude"
                      type="number"
                      step="any"
                      min={-180}
                      max={180}
                      value={form.longitude}
                      onChange={(event) =>
                        setForm((previous) => ({
                          ...previous,
                          longitude: event.target.value,
                        }))
                      }
                      className="input"
                      placeholder="-3.7038"
                    />
                  </div>
                  <div>
                    <label htmlFor="checkpoint-radius" className="label">
                      Radio de geovalla (m)
                    </label>
                    <input
                      id="checkpoint-radius"
                      type="number"
                      min={10}
                      max={1000}
                      step={5}
                      required
                      value={form.geofence_radius_m}
                      onChange={(event) =>
                        setForm((previous) => ({
                          ...previous,
                          geofence_radius_m: event.target.value,
                        }))
                      }
                      className="input"
                    />
                  </div>
                </div>
                <p className="-mt-1 text-xs text-slate-500">
                  Las coordenadas son opcionales. Si las deja vacías, el punto se
                  crea igualmente y podrá completarlas después desde este panel o
                  desde la app móvil antes de que los guardias marquen por QR.
                </p>
              </>
            ) : null}

            <div>
              <label htmlFor="checkpoint-location" className="label">
                Descripción de la ubicación
              </label>
              <textarea
                id="checkpoint-location"
                rows={3}
                maxLength={2000}
                value={form.location_description}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    location_description: event.target.value,
                  }))
                }
                className="textarea"
                placeholder="Detalle cómo llegar al punto, referencias físicas, piso, sector…"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-odoo-600 focus:ring-odoo-500"
                checked={form.is_active}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    is_active: event.target.checked,
                  }))
                }
              />
              <span>
                <span className="block text-sm font-semibold text-slate-700">
                  Punto de control activo
                </span>
                <span className="block text-xs text-slate-500">
                  Los puntos inactivos se conservan, pero no deberían usarse en
                  nuevas rondas.
                </span>
              </span>
            </label>
          </form>
        </Modal>
      ) : null}

      {toggleTarget ? (
        <ConfirmDialog
          title={
            toggleTarget.is_active
              ? "Desactivar punto de control"
              : "Reactivar punto de control"
          }
          description={
            toggleTarget.is_active
              ? `El punto "${toggleTarget.name}" dejará de estar disponible para nuevas rondas. No se elimina y puede reactivarse más adelante.`
              : `El punto "${toggleTarget.name}" volverá a estar disponible para las rondas de su empresa.`
          }
          confirmLabel={
            toggleTarget.is_active ? "Sí, desactivar" : "Sí, reactivar"
          }
          tone={toggleTarget.is_active ? "danger" : "primary"}
          busy={toggleBusy}
          onClose={() => setToggleTarget(null)}
          onConfirm={toggleActive}
        />
      ) : null}

      {qrTarget ? (
        <Modal
          icon={QrCode}
          title="Código QR del punto de control"
          subtitle="Imprima y fije la etiqueta en la ubicación física para que el personal la escanee."
          onClose={() => setQrTarget(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setQrTarget(null)}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDownloadQr}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Descargar PNG
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePrintQr}
              >
                <Printer className="h-4 w-4" aria-hidden="true" />
                Imprimir
              </button>
            </>
          }
        >
          <ErrorAlert message={qrError} />

          <div className="rounded-xl border border-odoo-100 bg-gradient-to-b from-odoo-50 to-white p-5 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-odoo-700">
              Sistema de Rondas
            </p>
            <h3 className="mt-2 text-lg font-bold text-slate-800">
              {qrTarget.name}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {qrTarget.company?.name || `Empresa #${qrTarget.company_id}`}
            </p>

            <div
              ref={qrCanvasRef}
              className="mx-auto mt-4 inline-block rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <QRCodeCanvas
                value={qrTarget.code}
                size={512}
                level="H"
                marginSize={2}
                bgColor="#ffffff"
                fgColor="#111827"
                style={{ width: 256, height: 256 }}
                title={`Código QR ${qrTarget.code}`}
              />
            </div>

            <p className="mt-4 inline-block rounded bg-slate-100 px-4 py-1.5 font-mono text-sm font-bold tracking-wide text-slate-700">
              {qrTarget.code}
            </p>
            {qrTarget.location_description ? (
              <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-slate-500">
                {qrTarget.location_description}
              </p>
            ) : null}
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-500">
            El QR contiene únicamente el código del punto. Verifique que el código
            sea el correcto antes de imprimir la etiqueta.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
